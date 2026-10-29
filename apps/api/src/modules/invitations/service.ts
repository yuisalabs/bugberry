import type { AccountLimits } from "../../config"
import { type Db, withTransaction } from "../../db/client"
import { AppError } from "../../lib/errors"
import { updateUser } from "../account/repository"
import { deleteJoinRequest } from "../join/repository"
import { assertCanAddMembers } from "../workspaces/limits"
import { addMemberIfAbsent } from "../workspaces/repository"
import { markInvitationAccepted } from "./repository"

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
    await assertCanAddMembers(db, limits, workspaceId, "joiner")
    const invitation = await markInvitationAccepted(db, invitationId)
    if (!invitation) throw gone()
    await addMemberIfAbsent(db, workspaceId, userId, invitation.role)
    // A request to join that was still waiting is answered now.
    await deleteJoinRequest(db, workspaceId, userId)
    await updateUser(db, userId, { lastWorkspaceId: workspaceId })
  })
  return { workspaceId }
}
