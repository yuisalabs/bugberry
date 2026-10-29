import type { WorkspaceRole } from "@bugberry/shared"
import type { AccountLimits } from "../../config"
import { type Db, withTransaction } from "../../db/client"
import { conflict, notFound, unprocessable } from "../../lib/errors"
import { assertCanCreateWorkspace } from "./limits"
import { createWorkspace } from "./provision"
import {
  deleteMember,
  findMemberRole,
  findOwnerId,
  listMembers,
  lockAdmins,
  lockWorkspaceCreation,
  updateMemberRole,
  updateWorkspace,
} from "./repository"
import { isUniqueViolation, slugProblem, slugTaken } from "./slug"

const ownerProtected = () => conflict("owner_protected", "The workspace owner can't be removed or demoted")

/**
 * Throws when `userId` is the workspace's only admin. Locking the admin rows makes a concurrent
 * demotion or departure wait, then count again, so two admins cannot both step down and leave none.
 */
async function assertAnotherAdmin(db: Db, workspaceId: string, userId: string): Promise<void> {
  const admins = await lockAdmins(db, workspaceId)
  if (admins.every((admin) => admin === userId)) {
    throw conflict("last_admin", "At least one admin must remain")
  }
}

/** A workspace the person creates and owns, within their account's limit. */
export function createOwnWorkspace(db: Db, limits: AccountLimits | null, userId: string, name: string, slug?: string) {
  return withTransaction(db, async () => {
    // One at a time per person, so requests sent together can't all pass the owned-workspace check.
    await lockWorkspaceCreation(db, userId)
    await assertCanCreateWorkspace(db, limits, userId)
    return createWorkspace(db, userId, name, slug)
  })
}

/** Renames the workspace or changes its URL; a URL taken in the meantime is refused like one taken before. */
export async function changeWorkspace(db: Db, workspaceId: string, body: { name?: string; slug?: string }) {
  const changes: { name?: string; slug?: string } = {}
  if (body.name !== undefined) changes.name = body.name.trim()
  if (body.slug !== undefined) {
    const typed = body.slug.trim()
    if (slugProblem(typed)) throw unprocessable("invalid_slug", "Use 3–40 lowercase letters, numbers or dashes")
    if (await slugTaken(db, typed, workspaceId)) throw conflict("slug_taken", "This URL is taken")
    changes.slug = typed
  }
  try {
    const updated = await updateWorkspace(db, workspaceId, changes)
    if (!updated) throw notFound("workspace_not_found", "Workspace not found")
    return { ...updated, slug: updated.slug ?? "" }
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("slug_taken", "This URL is taken")
    throw error
  }
}

export async function membersOf(db: Db, workspaceId: string) {
  const ownerId = await findOwnerId(db, workspaceId)
  const rows = await listMembers(db, workspaceId)
  return rows.map((row) => ({ ...row, owner: row.id === ownerId }))
}

/** The owner's role never changes, and the last admin can't become a member. */
export function changeMemberRole(db: Db, workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
  return withTransaction(db, async () => {
    const current = await findMemberRole(db, userId, workspaceId)
    if (!current) throw notFound("member_not_found", "Member not found")
    if ((await findOwnerId(db, workspaceId)) === userId) throw ownerProtected()
    if (current === "admin" && role === "member") await assertAnotherAdmin(db, workspaceId, userId)
    await updateMemberRole(db, workspaceId, userId, role)
  })
}

/** Removes a member, or lets the caller leave; neither the owner nor the last admin can go. */
export function removeMember(db: Db, workspaceId: string, callerId: string, userId: string): Promise<void> {
  return withTransaction(db, async () => {
    const current = await findMemberRole(db, userId, workspaceId)
    if (!current) throw notFound("member_not_found", "Member not found")
    if ((await findOwnerId(db, workspaceId)) === userId) {
      throw userId === callerId ? conflict("owner_cannot_leave", "The workspace owner can't leave the workspace") : ownerProtected()
    }
    if (current === "admin") await assertAnotherAdmin(db, workspaceId, userId)
    await deleteMember(db, workspaceId, userId)
  })
}
