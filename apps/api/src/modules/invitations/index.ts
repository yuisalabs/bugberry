import { and, asc, eq, gt, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { isEmailAllowed } from "../../auth/policy"
import type { AccountLimits } from "../../config"
import type { Db } from "../../db/client"
import { joinRequest, user, workspace, workspaceInvitation, workspaceMember } from "../../db/schema"
import { inviteEmail } from "../../email/invite-email"
import { hashCode, newJoinCode } from "../../workspaces/join-codes"
import { createEmailSender, type EmailSender } from "../../email/sender"
import { AppError, conflict, notFound, tooManyRequests } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { createRateLimiter } from "../../lib/rate-limit"
import { requireMember } from "../../workspaces/access"
import { assertCanAddMembers, isWorkspaceLimited } from "../../workspaces/limits"
import { hashInviteToken, INVITE_TTL_MS, invitationStatus, inviteUrl, newInviteToken } from "../../workspaces/invitations"

const INVITES_PER_WORKSPACE_PER_HOUR = 50
/** Sign-up is open, so one person with many workspaces must not be able to send more than this. */
const INVITES_PER_PERSON_PER_HOUR = 50
const inviter = alias(user, "inviter")

export type InviteOutcome = "sent" | "member" | "pending" | "not_allowed" | "invalid"

const gone = () => new AppError(410, "invite_unavailable", "This invitation has expired or was withdrawn")

/**
 * Adds the person to the invitation's workspace once, with the invitation's role, and makes it their current workspace. A workspace
 * under ACCOUNT_LIMITS takes no new members; the invitation then stays pending.
 */
export async function accept(
  db: Db,
  limits: AccountLimits | null,
  invitationId: string,
  workspaceId: string,
  userId: string,
): Promise<{ workspaceId: string }> {
  await db.transaction(async (tx) => {
    await assertCanAddMembers(tx, limits, workspaceId, "joiner")
    const marked = await tx
      .update(workspaceInvitation)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitation.id, invitationId),
          isNull(workspaceInvitation.acceptedAt),
          isNull(workspaceInvitation.revokedAt),
          gt(workspaceInvitation.expiresAt, new Date()),
        ),
      )
      .returning({ id: workspaceInvitation.id, role: workspaceInvitation.role })
    const [invitation] = marked
    if (!invitation) throw gone()
    await tx.insert(workspaceMember).values({ workspaceId, userId, role: invitation.role }).onConflictDoNothing()
    // A request to join that was still waiting is answered now.
    await tx.delete(joinRequest).where(and(eq(joinRequest.workspaceId, workspaceId), eq(joinRequest.userId, userId)))
    await tx.update(user).set({ lastWorkspaceId: workspaceId }).where(eq(user.id, userId))
  })
  return { workspaceId }
}

export function invitationsModule(deps: AppDeps) {
  const { config, db } = deps
  const sender: EmailSender | null = deps.email ?? (config.email ? createEmailSender(config.email) : null)
  const limiter = createRateLimiter({ limit: INVITES_PER_WORKSPACE_PER_HOUR, windowMs: 60 * 60 * 1000 })
  const perPerson = createRateLimiter({ limit: INVITES_PER_PERSON_PER_HOUR, windowMs: 60 * 60 * 1000 })

  const workspaceName = async (workspaceId: string) =>
    (await db.select({ name: workspace.name }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1))[0]?.name ?? ""

  const sendInvite = async (to: string, workspaceId: string, from: { id: string; name: string }, token: string, code: string) => {
    if (!sender) throw conflict("email_unavailable", "Set up email (EMAIL_DRIVER) to send invitations")
    if (!limiter.consume(workspaceId) || !perPerson.consume(from.id)) throw tooManyRequests()
    const mail = inviteEmail({ workspaceName: await workspaceName(workspaceId), inviterName: from.name, url: inviteUrl(config.appUrl, token), code })
    await sender.send({ to, ...mail })
  }

  const liveNow = () =>
    and(isNull(workspaceInvitation.acceptedAt), isNull(workspaceInvitation.revokedAt), gt(workspaceInvitation.expiresAt, new Date()))

  const findLive = async (workspaceId: string, invitationId: string) => {
    const [row] = await db
      .select()
      .from(workspaceInvitation)
      .where(and(eq(workspaceInvitation.id, invitationId), eq(workspaceInvitation.workspaceId, workspaceId), liveNow()))
      .limit(1)
    if (!row) throw notFound("invitation_not_found", "Invitation not found")
    return row
  }

  const byToken = async (token: string) => {
    const [row] = await db
      .select({
        invitation: workspaceInvitation,
        workspaceName: workspace.name,
        inviterName: inviter.name,
      })
      .from(workspaceInvitation)
      .innerJoin(workspace, eq(workspace.id, workspaceInvitation.workspaceId))
      .leftJoin(inviter, eq(inviter.id, workspaceInvitation.invitedById))
      .where(eq(workspaceInvitation.tokenHash, hashInviteToken(token)))
      .limit(1)
    if (!row) throw notFound("invitation_not_found", "Invitation not found")
    return row
  }

  return new Elysia()
    .use(authPlugin(deps))
    .post(
      "/workspaces/:id/invitations",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        await assertCanAddMembers(db, config.accountLimits, params.id)
        const outcomes: Array<{ email: string; status: InviteOutcome }> = []
        for (const raw of body.emails) {
          const email = raw.trim().toLowerCase()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            outcomes.push({ email, status: "invalid" })
            continue
          }
          if (config.allowedEmailDomains.length > 0 && !isEmailAllowed(email, config.allowedEmailDomains)) {
            outcomes.push({ email, status: "not_allowed" })
            continue
          }
          const [existingMember] = await db
            .select({ id: user.id })
            .from(workspaceMember)
            .innerJoin(user, eq(user.id, workspaceMember.userId))
            .where(and(eq(workspaceMember.workspaceId, params.id), eq(user.email, email)))
            .limit(1)
          if (existingMember) {
            outcomes.push({ email, status: "member" })
            continue
          }
          const [pending] = await db
            .select({ id: workspaceInvitation.id })
            .from(workspaceInvitation)
            .where(and(eq(workspaceInvitation.workspaceId, params.id), eq(workspaceInvitation.email, email), liveNow()))
            .limit(1)
          if (pending) {
            outcomes.push({ email, status: "pending" })
            continue
          }
          const { token, hash } = newInviteToken()
          const code = newJoinCode()
          await sendInvite(email, params.id, current, token, code)
          await db.insert(workspaceInvitation).values({
            id: newId(),
            workspaceId: params.id,
            email,
            tokenHash: hash,
            codeHash: hashCode(code),
            invitedById: current.id,
            role: body.role ?? "member",
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          })
          outcomes.push({ email, status: "sent" })
        }
        return outcomes
      },
      {
        auth: true,
        // Checked per address above, after trimming, so one typo does not reject the whole list.
        body: t.Object({
          emails: t.Array(t.String({ minLength: 1, maxLength: 254 }), { minItems: 1, maxItems: 20 }),
          /** What they join as; member when left out. */
          role: t.Optional(t.UnionEnum(["member", "admin"])),
        }),
      },
    )
    .get(
      "/workspaces/:id/invitations",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        const rows = await db
          .select({
            id: workspaceInvitation.id,
            email: workspaceInvitation.email,
            invitedBy: inviter.name,
            role: workspaceInvitation.role,
            expiresAt: workspaceInvitation.expiresAt,
          })
          .from(workspaceInvitation)
          .leftJoin(inviter, eq(inviter.id, workspaceInvitation.invitedById))
          .where(and(eq(workspaceInvitation.workspaceId, params.id), liveNow()))
          .orderBy(asc(workspaceInvitation.createdAt))
        // Sending (or resending) sets the expiry a fixed time ahead, so it also says when the email last went out.
        return rows.map((row) => ({ ...row, sentAt: new Date(row.expiresAt.getTime() - INVITE_TTL_MS) }))
      },
      { auth: true },
    )
    .delete(
      "/workspaces/:id/invitations/:invitationId",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        const row = await findLive(params.id, params.invitationId)
        await db.update(workspaceInvitation).set({ revokedAt: new Date() }).where(eq(workspaceInvitation.id, row.id))
        return { ok: true }
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/invitations/:invitationId/resend",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        await assertCanAddMembers(db, config.accountLimits, params.id)
        const row = await findLive(params.id, params.invitationId)
        const { token, hash } = newInviteToken()
        const code = newJoinCode()
        await sendInvite(row.email, params.id, current, token, code)
        await db
          .update(workspaceInvitation)
          .set({ tokenHash: hash, codeHash: hashCode(code), expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedById: current.id })
          .where(eq(workspaceInvitation.id, row.id))
        return { ok: true }
      },
      { auth: true },
    )
    // Public: the invitation page shows what it is before the person signs in.
    .get("/invitations/:token", async ({ params }) => {
      const row = await byToken(params.token)
      return {
        workspaceName: row.workspaceName,
        email: row.invitation.email,
        inviterName: row.inviterName ?? "Someone",
        status: invitationStatus(row.invitation),
      }
    })
    .post(
      "/invitations/:token/accept",
      async ({ user: current, params }) => {
        const row = await byToken(params.token)
        if (invitationStatus(row.invitation) !== "pending") throw gone()
        if (row.invitation.email !== current.email.trim().toLowerCase()) {
          throw new AppError(403, "invite_email_mismatch", `This invitation is for ${row.invitation.email}`)
        }
        return accept(db, config.accountLimits, row.invitation.id, row.invitation.workspaceId, current.id)
      },
      { auth: true },
    )
    .get(
      "/me/invitations",
      async ({ user: current }) => {
        const rows = await db
          .select({ id: workspaceInvitation.id, workspaceId: workspaceInvitation.workspaceId, workspaceName: workspace.name, inviterName: inviter.name })
          .from(workspaceInvitation)
          .innerJoin(workspace, eq(workspace.id, workspaceInvitation.workspaceId))
          .leftJoin(inviter, eq(inviter.id, workspaceInvitation.invitedById))
          .where(and(eq(workspaceInvitation.email, current.email.trim().toLowerCase()), liveNow()))
          .orderBy(asc(workspaceInvitation.createdAt))
        // A workspace under ACCOUNT_LIMITS takes nobody new: its invitations would only fail.
        const open = []
        for (const { workspaceId, ...row } of rows) if (!(await isWorkspaceLimited(db, config.accountLimits, workspaceId))) open.push(row)
        return open
      },
      { auth: true },
    )
    .post(
      "/me/invitations/:id/accept",
      async ({ user: current, params }) => {
        const [row] = await db
          .select()
          .from(workspaceInvitation)
          .where(and(eq(workspaceInvitation.id, params.id), eq(workspaceInvitation.email, current.email.trim().toLowerCase())))
          .limit(1)
        if (!row) throw notFound("invitation_not_found", "Invitation not found")
        if (invitationStatus(row) !== "pending") throw gone()
        return accept(db, config.accountLimits, row.id, row.workspaceId, current.id)
      },
      { auth: true },
    )
}
