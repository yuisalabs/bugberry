import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { isEmailAllowed } from "../auth/policy"
import { inviteEmail } from "./invite-email"
import { hashCode, newJoinCode } from "../join/join-codes"
import { createEmailSender, type EmailSender } from "../../lib/email/sender"
import { AppError, conflict, notFound, tooManyRequests } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { requireMember } from "../workspaces/access"
import { assertCanAddMembers, isWorkspaceLimited } from "../workspaces/limits"
import { findWorkspaceName } from "../workspaces/repository"
import {
  findInvitationByTokenHash,
  findInvitationForEmail,
  findLiveInvitation,
  hasLiveInvitation,
  insertInvitation,
  isMemberEmail,
  listLiveInvitations,
  listLiveInvitationsForEmail,
  renewInvitation,
  revokeInvitation,
} from "./repository"
import { accept, gone, hashInviteToken, INVITE_TTL_MS, invitationStatus, inviteUrl, newInviteToken } from "./service"

const INVITES_PER_WORKSPACE_PER_HOUR = 50
/** Sign-up is open, so one person with many workspaces must not be able to send more than this. */
const INVITES_PER_PERSON_PER_HOUR = 50

export type InviteOutcome = "sent" | "member" | "pending" | "not_allowed" | "invalid"

export function invitationsModule(deps: AppDeps) {
  const { config, db } = deps
  const sender: EmailSender | null = deps.email ?? (config.email ? createEmailSender(config.email) : null)
  const limiter = createRateLimiter({ limit: INVITES_PER_WORKSPACE_PER_HOUR, windowMs: 60 * 60 * 1000 })
  const perPerson = createRateLimiter({ limit: INVITES_PER_PERSON_PER_HOUR, windowMs: 60 * 60 * 1000 })

  const workspaceName = async (workspaceId: string) => (await findWorkspaceName(db, workspaceId)) ?? ""

  const sendInvite = async (to: string, workspaceId: string, from: { id: string; name: string }, token: string, code: string) => {
    if (!sender) throw conflict("email_unavailable", "Set up email (EMAIL_DRIVER) to send invitations")
    if (!limiter.consume(workspaceId) || !perPerson.consume(from.id)) throw tooManyRequests()
    const mail = inviteEmail({ workspaceName: await workspaceName(workspaceId), inviterName: from.name, url: inviteUrl(config.appUrl, token), code })
    await sender.send({ to, ...mail })
  }

  const findLive = async (workspaceId: string, invitationId: string) => {
    const row = await findLiveInvitation(db, workspaceId, invitationId)
    if (!row) throw notFound("invitation_not_found", "Invitation not found")
    return row
  }

  const byToken = async (token: string) => {
    const row = await findInvitationByTokenHash(db, hashInviteToken(token))
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
          if (await isMemberEmail(db, params.id, email)) {
            outcomes.push({ email, status: "member" })
            continue
          }
          if (await hasLiveInvitation(db, params.id, email)) {
            outcomes.push({ email, status: "pending" })
            continue
          }
          const { token, hash } = newInviteToken()
          const code = newJoinCode()
          await sendInvite(email, params.id, current, token, code)
          await insertInvitation(db, {
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
        const rows = await listLiveInvitations(db, params.id)
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
        await revokeInvitation(db, row.id)
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
        await renewInvitation(db, row.id, {
          tokenHash: hash,
          codeHash: hashCode(code),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedById: current.id,
        })
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
        const rows = await listLiveInvitationsForEmail(db, current.email.trim().toLowerCase())
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
        const row = await findInvitationForEmail(db, params.id, current.email.trim().toLowerCase())
        if (!row) throw notFound("invitation_not_found", "Invitation not found")
        if (invitationStatus(row) !== "pending") throw gone()
        return accept(db, config.accountLimits, row.id, row.workspaceId, current.id)
      },
      { auth: true },
    )
}
