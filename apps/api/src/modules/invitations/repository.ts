import type { WorkspaceRole } from "@bugberry/shared"
import { and, asc, eq, gt, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { type Db, executor } from "../../db/client"
import { user, workspace, workspaceInvitation, workspaceMember } from "../../db/schema"
import { newId } from "../../lib/ids"

const inviter = alias(user, "inviter")

const live = () =>
  and(isNull(workspaceInvitation.acceptedAt), isNull(workspaceInvitation.revokedAt), gt(workspaceInvitation.expiresAt, new Date()))

/** Marks a live invitation accepted; null when it was not live any more. */
export async function markInvitationAccepted(db: Db, invitationId: string): Promise<{ id: string; role: WorkspaceRole } | null> {
  const [invitation] = await executor(db)
    .update(workspaceInvitation)
    .set({ acceptedAt: new Date() })
    .where(and(eq(workspaceInvitation.id, invitationId), live()))
    .returning({ id: workspaceInvitation.id, role: workspaceInvitation.role })
  return invitation ?? null
}

export async function findLiveInvitation(db: Db, workspaceId: string, invitationId: string) {
  const [row] = await executor(db)
    .select()
    .from(workspaceInvitation)
    .where(and(eq(workspaceInvitation.id, invitationId), eq(workspaceInvitation.workspaceId, workspaceId), live()))
    .limit(1)
  return row ?? null
}

/** A live invitation by the hash of its link token or of its code, with who sent it. */
export async function findLiveInvitationByHash(db: Db, by: { tokenHash: string } | { codeHash: string }) {
  const match = "tokenHash" in by ? eq(workspaceInvitation.tokenHash, by.tokenHash) : eq(workspaceInvitation.codeHash, by.codeHash)
  const [row] = await executor(db)
    .select({ id: workspaceInvitation.id, workspaceId: workspaceInvitation.workspaceId, email: workspaceInvitation.email, inviterName: inviter.name })
    .from(workspaceInvitation)
    .leftJoin(inviter, eq(inviter.id, workspaceInvitation.invitedById))
    .where(and(match, live()))
    .limit(1)
  return row ?? null
}

/** Any invitation by its link token's hash, live or not, with its workspace's name and who sent it. */
export async function findInvitationByTokenHash(db: Db, tokenHash: string) {
  const [row] = await executor(db)
    .select({ invitation: workspaceInvitation, workspaceName: workspace.name, inviterName: inviter.name })
    .from(workspaceInvitation)
    .innerJoin(workspace, eq(workspace.id, workspaceInvitation.workspaceId))
    .leftJoin(inviter, eq(inviter.id, workspaceInvitation.invitedById))
    .where(eq(workspaceInvitation.tokenHash, tokenHash))
    .limit(1)
  return row ?? null
}

export async function findInvitationForEmail(db: Db, invitationId: string, email: string) {
  const [row] = await executor(db)
    .select()
    .from(workspaceInvitation)
    .where(and(eq(workspaceInvitation.id, invitationId), eq(workspaceInvitation.email, email)))
    .limit(1)
  return row ?? null
}

export async function isMemberEmail(db: Db, workspaceId: string, email: string): Promise<boolean> {
  const [row] = await executor(db)
    .select({ id: user.id })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(user.email, email)))
    .limit(1)
  return row !== undefined
}

export async function hasLiveInvitation(db: Db, workspaceId: string, email: string): Promise<boolean> {
  const [row] = await executor(db)
    .select({ id: workspaceInvitation.id })
    .from(workspaceInvitation)
    .where(and(eq(workspaceInvitation.workspaceId, workspaceId), eq(workspaceInvitation.email, email), live()))
    .limit(1)
  return row !== undefined
}

export async function insertInvitation(
  db: Db,
  input: { workspaceId: string; email: string; tokenHash: string; codeHash: string; invitedById: string; role: WorkspaceRole; expiresAt: Date },
): Promise<void> {
  await executor(db).insert(workspaceInvitation).values({ id: newId(), ...input })
}

/** The workspace's live invitations, oldest first. */
export function listLiveInvitations(db: Db, workspaceId: string) {
  return executor(db)
    .select({
      id: workspaceInvitation.id,
      email: workspaceInvitation.email,
      invitedBy: inviter.name,
      role: workspaceInvitation.role,
      expiresAt: workspaceInvitation.expiresAt,
    })
    .from(workspaceInvitation)
    .leftJoin(inviter, eq(inviter.id, workspaceInvitation.invitedById))
    .where(and(eq(workspaceInvitation.workspaceId, workspaceId), live()))
    .orderBy(asc(workspaceInvitation.createdAt))
}

/** Live invitations for this address, oldest first, with each workspace's name and who sent it. */
export function listLiveInvitationsForEmail(db: Db, email: string) {
  return executor(db)
    .select({ id: workspaceInvitation.id, workspaceId: workspaceInvitation.workspaceId, workspaceName: workspace.name, inviterName: inviter.name })
    .from(workspaceInvitation)
    .innerJoin(workspace, eq(workspace.id, workspaceInvitation.workspaceId))
    .leftJoin(inviter, eq(inviter.id, workspaceInvitation.invitedById))
    .where(and(eq(workspaceInvitation.email, email), live()))
    .orderBy(asc(workspaceInvitation.createdAt))
}

export async function revokeInvitation(db: Db, invitationId: string): Promise<void> {
  await executor(db).update(workspaceInvitation).set({ revokedAt: new Date() }).where(eq(workspaceInvitation.id, invitationId))
}

/** A new link and code for the invitation, sent by `invitedById`, live until `expiresAt`. */
export async function renewInvitation(
  db: Db,
  invitationId: string,
  input: { tokenHash: string; codeHash: string; expiresAt: Date; invitedById: string },
): Promise<void> {
  await executor(db).update(workspaceInvitation).set(input).where(eq(workspaceInvitation.id, invitationId))
}
