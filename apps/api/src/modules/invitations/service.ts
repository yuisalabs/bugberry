import { MAX_GUESTS_PER_PROJECT, type WorkspaceRole } from "@bugberry/shared"
import type { AccountLimits } from "../../config"
import { type Db, withTransaction } from "../../db/client"
import type { AppDeps } from "../../deps"
import { createEmailSender, type EmailSender } from "../../lib/email/sender"
import { AppError, conflict, notFound, tooManyRequests, unprocessable } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { updateUser } from "../account/repository"
import { isEmailAllowed } from "../auth/policy"
import { hashCode, newJoinCode } from "../join/join-codes"
import { deleteJoinRequest } from "../join/repository"
import { assertCanAddMembers, isWorkspaceLimited } from "../workspaces/limits"
import { countGuests, insertGuest, isProjectGuestEmail, lockProject } from "../guests/repository"
import { addMemberIfAbsent, findMemberRole, findWorkspaceName } from "../workspaces/repository"
import { inviteEmail } from "./invite-email"
import {
  findInvitationByTokenHash,
  findInvitationForEmail,
  findLiveInvitation,
  countLiveGuestInvitations,
  hasLiveInvitation,
  insertInvitation,
  isMemberEmail,
  listLiveInvitations,
  listLiveInvitationsForEmail,
  markInvitationAccepted,
  renewInvitation,
  revokeInvitation,
} from "./repository"

/** A project takes at most MAX_GUESTS_PER_PROJECT guests, its pending guest invitations counted. */
async function assertGuestRoom(db: Db, projectId: string, adding: number): Promise<void> {
  if (adding === 0) return
  const taken = (await countGuests(db, projectId)) + (await countLiveGuestInvitations(db, projectId))
  if (taken + adding > MAX_GUESTS_PER_PROJECT) {
    throw unprocessable("guest_limit", `A project can have at most ${MAX_GUESTS_PER_PROJECT} guests, invitations included`)
  }
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** A random invitation token; only its SHA-256 is stored, so a database leak reveals no working link. */
export function newInviteToken(): { token: string; hash: string } {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  return { token, hash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex")
}

export function inviteUrl(appUrl: string, token: string): string {
  return `${appUrl}/invite/${token}`
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked"

export function invitationStatus(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()): InvitationStatus {
  if (row.acceptedAt) return "accepted"
  if (row.revokedAt) return "revoked"
  return row.expiresAt <= now ? "expired" : "pending"
}

export const gone = () => new AppError(410, "invite_unavailable", "This invitation has expired or was withdrawn")

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
  await withTransaction(db, async () => {
    const invitation = await markInvitationAccepted(db, invitationId)
    if (!invitation) throw gone()
    if (invitation.guestProjectId) {
      // A guest is not a member, so the member limit doesn't apply; someone already a member keeps that instead.
      if (!(await findMemberRole(db, userId, workspaceId))) {
        await insertGuest(db, { projectId: invitation.guestProjectId, userId, invitedById: invitation.invitedById })
      }
      await updateUser(db, userId, { lastWorkspaceId: workspaceId })
      return
    }
    await assertCanAddMembers(db, limits, workspaceId, "joiner")
    await addMemberIfAbsent(db, workspaceId, userId, invitation.role)
    // A request to join that was still waiting is answered now.
    await deleteJoinRequest(db, workspaceId, userId)
    await updateUser(db, userId, { lastWorkspaceId: workspaceId })
  })
  return { workspaceId }
}

const INVITES_PER_WORKSPACE_PER_HOUR = 50
/** Sign-up is open, so one person with many workspaces must not be able to send more than this. */
const INVITES_PER_PERSON_PER_HOUR = 50

export type InviteOutcome = "sent" | "member" | "guest" | "pending" | "not_allowed" | "invalid"

/** Sending, resending, withdrawing and accepting invitations. */
export function createInvitationsService(deps: Pick<AppDeps, "config" | "db" | "email">) {
  const { config, db } = deps
  const sender: EmailSender | null = deps.email ?? (config.email ? createEmailSender(config.email) : null)
  const limiter = createRateLimiter({ limit: INVITES_PER_WORKSPACE_PER_HOUR, windowMs: 60 * 60 * 1000 })
  const perPerson = createRateLimiter({ limit: INVITES_PER_PERSON_PER_HOUR, windowMs: 60 * 60 * 1000 })

  const sendInvite = async (
    to: string,
    workspaceId: string,
    from: { id: string; name: string },
    token: string,
    code: string,
    projectName?: string,
  ) => {
    if (!sender) throw conflict("email_unavailable", "Set up email (EMAIL_DRIVER) to send invitations")
    if (!limiter.consume(workspaceId) || !perPerson.consume(from.id)) throw tooManyRequests()
    const workspaceName = (await findWorkspaceName(db, workspaceId)) ?? ""
    const mail = inviteEmail({ workspaceName, inviterName: from.name, url: inviteUrl(config.appUrl, token), code, projectName })
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

  return {
    /**
     * One outcome per address, in order; each is checked on its own, so one typo never rejects the whole list. With
     * `guestOf`, each address is invited as a guest of that project: no member limit, and "guest" for one already.
     */
    async invite(
      workspaceId: string,
      from: { id: string; name: string },
      emails: string[],
      role: WorkspaceRole,
      guestOf?: { projectId: string; projectName: string },
    ) {
      if (!guestOf) await assertCanAddMembers(db, config.accountLimits, workspaceId)
      const outcomes: Array<{ email: string; status: InviteOutcome | "send" }> = []
      for (const raw of emails) {
        const email = raw.trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          outcomes.push({ email, status: "invalid" })
          continue
        }
        if (config.allowedEmailDomains.length > 0 && !isEmailAllowed(email, config.allowedEmailDomains)) {
          outcomes.push({ email, status: "not_allowed" })
          continue
        }
        if (await isMemberEmail(db, workspaceId, email)) {
          outcomes.push({ email, status: "member" })
          continue
        }
        if (guestOf && (await isProjectGuestEmail(db, guestOf.projectId, email))) {
          outcomes.push({ email, status: "guest" })
          continue
        }
        if (await hasLiveInvitation(db, workspaceId, email, guestOf?.projectId ?? null)) {
          outcomes.push({ email, status: "pending" })
          continue
        }
        outcomes.push({ email, status: "send" })
      }
      // Only the addresses that get an invitation take a guest's place.
      if (guestOf) await assertGuestRoom(db, guestOf.projectId, outcomes.filter((row) => row.status === "send").length)
      const sendOne = async (email: string) => {
        const { token, hash } = newInviteToken()
        const code = newJoinCode()
        await sendInvite(email, workspaceId, from, token, code, guestOf?.projectName)
        await insertInvitation(db, {
          guestProjectId: guestOf?.projectId ?? null,
          workspaceId,
          email,
          tokenHash: hash,
          codeHash: hashCode(code),
          invitedById: from.id,
          role,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
      }
      for (const row of outcomes) {
        if (row.status !== "send") continue
        if (guestOf) {
          // Counted again under the project's lock, so invitations sent at once can't pass the limit together.
          await withTransaction(db, async () => {
            await lockProject(db, guestOf.projectId)
            await assertGuestRoom(db, guestOf.projectId, 1)
            await sendOne(row.email)
          })
        } else {
          await sendOne(row.email)
        }
        row.status = "sent"
      }
      return outcomes as Array<{ email: string; status: InviteOutcome }>
    },

    async listLive(workspaceId: string) {
      const rows = await listLiveInvitations(db, workspaceId)
      // Sending (or resending) sets the expiry a fixed time ahead, so it also says when the email last went out.
      return rows.map((row) => ({ ...row, sentAt: new Date(row.expiresAt.getTime() - INVITE_TTL_MS) }))
    },

    async revoke(workspaceId: string, invitationId: string) {
      const row = await findLive(workspaceId, invitationId)
      await revokeInvitation(db, row.id)
      return { ok: true }
    },

    /** A new link and code, sent again; the old ones stop working. */
    async resend(workspaceId: string, invitationId: string, from: { id: string; name: string }) {
      await assertCanAddMembers(db, config.accountLimits, workspaceId)
      const row = await findLive(workspaceId, invitationId)
      const { token, hash } = newInviteToken()
      const code = newJoinCode()
      await sendInvite(row.email, workspaceId, from, token, code)
      await renewInvitation(db, row.id, {
        tokenHash: hash,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: from.id,
      })
      return { ok: true }
    },

    async preview(token: string) {
      const row = await byToken(token)
      return {
        workspaceName: row.workspaceName,
        email: row.invitation.email,
        inviterName: row.inviterName ?? "Someone",
        guestProjectName: row.guestProjectName,
        status: invitationStatus(row.invitation),
      }
    },

    async acceptByToken(token: string, person: { id: string; email: string }) {
      const row = await byToken(token)
      if (invitationStatus(row.invitation) !== "pending") throw gone()
      if (row.invitation.email !== person.email.trim().toLowerCase()) {
        throw new AppError(403, "invite_email_mismatch", `This invitation is for ${row.invitation.email}`)
      }
      return accept(db, config.accountLimits, row.invitation.id, row.invitation.workspaceId, person.id)
    },

    /**
     * A workspace under ACCOUNT_LIMITS takes no new members, so its invitations to join, which would only fail, aren't
     * listed; a guest isn't a member, so a guest invitation is.
     */
    async listMine(email: string) {
      const rows = await listLiveInvitationsForEmail(db, email.trim().toLowerCase())
      const open = []
      for (const { workspaceId, ...row } of rows) {
        if (row.guestProjectName !== null || !(await isWorkspaceLimited(db, config.accountLimits, workspaceId))) open.push(row)
      }
      return open
    },

    async acceptMine(invitationId: string, person: { id: string; email: string }) {
      const row = await findInvitationForEmail(db, invitationId, person.email.trim().toLowerCase())
      if (!row) throw notFound("invitation_not_found", "Invitation not found")
      if (invitationStatus(row) !== "pending") throw gone()
      return accept(db, config.accountLimits, row.id, row.workspaceId, person.id)
    },
  }
}
