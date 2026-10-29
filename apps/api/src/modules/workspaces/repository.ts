import type { CaptureType, Visibility, WorkspaceRole } from "@bugberry/shared"
import { and, asc, count, eq, gt, isNull, like, ne, or, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { pendingLogo, project, report, user, workspace, workspaceInvitation, workspaceMember } from "../../db/schema"
import { newId } from "../../lib/ids"

const member = (workspaceId: string, userId: string) =>
  and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId))

export async function findMemberRole(db: Db, userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const [row] = await executor(db).select({ role: workspaceMember.role }).from(workspaceMember).where(member(workspaceId, userId)).limit(1)
  return row?.role ?? null
}

/** The workspace the person joined first, or null for none. */
export async function findOldestMembership(db: Db, userId: string): Promise<string | null> {
  const [oldest] = await executor(db)
    .select({ workspaceId: workspaceMember.workspaceId })
    .from(workspaceMember)
    .where(eq(workspaceMember.userId, userId))
    .orderBy(asc(workspaceMember.createdAt))
    .limit(1)
  return oldest?.workspaceId ?? null
}

export async function findProjectWorkspace(db: Db, projectId: string): Promise<string | null> {
  const [row] = await executor(db).select({ workspaceId: project.workspaceId }).from(project).where(eq(project.id, projectId)).limit(1)
  return row?.workspaceId ?? null
}

/** Whose report it is and who may see it, for the access checks. */
export async function findReportAccess(
  db: Db,
  reportId: string,
): Promise<{ workspaceId: string; reporterId: string; reporterDomain: string | null; visibility: Visibility } | null> {
  const [row] = await executor(db)
    .select({
      workspaceId: report.workspaceId,
      reporterId: report.reporterId,
      reporterDomain: report.reporterDomain,
      visibility: report.visibility,
    })
    .from(report)
    .where(eq(report.id, reportId))
    .limit(1)
  return row ?? null
}

/** The person's workspaces with their role there, by name. */
export function listMemberships(db: Db, userId: string) {
  return executor(db)
    .select({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logoUrl: workspace.logoUrl,
      role: workspaceMember.role,
      ownerId: workspace.ownerId,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(eq(workspaceMember.userId, userId))
    .orderBy(asc(workspace.name), asc(workspace.id))
}

/** One workspace creation at a time per person, until the transaction ends. */
export async function lockWorkspaceCreation(db: Db, userId: string): Promise<void> {
  await executor(db).execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
}

export async function updateWorkspace(db: Db, workspaceId: string, changes: { name?: string; slug?: string }) {
  const [updated] = await executor(db)
    .update(workspace)
    .set(changes)
    .where(eq(workspace.id, workspaceId))
    .returning({ id: workspace.id, name: workspace.name, slug: workspace.slug })
  return updated ?? null
}

/** The workspace's owner, or null for a workspace from before owners existed. */
export async function findOwnerId(db: Db, workspaceId: string): Promise<string | null> {
  const [row] = await executor(db).select({ ownerId: workspace.ownerId }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1)
  return row?.ownerId ?? null
}

/** Locks the workspace's admin rows until the transaction ends, and returns who they are. */
export async function lockAdmins(db: Db, workspaceId: string): Promise<string[]> {
  const admins = await executor(db)
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, "admin")))
    .for("update")
  return admins.map((admin) => admin.userId)
}

export function listMembers(db: Db, workspaceId: string) {
  return executor(db)
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: workspaceMember.role,
      joinedAt: workspaceMember.createdAt,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(eq(workspaceMember.workspaceId, workspaceId))
    .orderBy(asc(user.name), asc(user.email))
}

export async function findMember(db: Db, workspaceId: string, userId: string) {
  const [row] = await executor(db)
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, role: workspaceMember.role })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(member(workspaceId, userId))
    .limit(1)
  return row ?? null
}

export async function updateMemberRole(db: Db, workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
  await executor(db).update(workspaceMember).set({ role }).where(member(workspaceId, userId))
}

/** Takes the person out of the workspace: their reports stay, work assigned to them there goes back to nobody. */
export async function deleteMember(db: Db, workspaceId: string, userId: string): Promise<void> {
  const x = executor(db)
  await x.delete(workspaceMember).where(member(workspaceId, userId))
  await x.update(report).set({ assigneeId: null }).where(and(eq(report.workspaceId, workspaceId), eq(report.assigneeId, userId)))
  await x.update(user).set({ lastWorkspaceId: null }).where(and(eq(user.id, userId), eq(user.lastWorkspaceId, workspaceId)))
}

/** The workspace with its owner and first admin, made the owner's current workspace. */
export async function insertWorkspace(db: Db, input: { name: string; slug: string; ownerId: string }) {
  const x = executor(db)
  const [created] = await x
    .insert(workspace)
    .values({ id: newId(), ...input })
    .returning({ id: workspace.id, name: workspace.name, slug: workspace.slug })
  if (!created) throw new Error("Failed to create workspace")
  await x.insert(workspaceMember).values({ workspaceId: created.id, userId: input.ownerId, role: "admin" })
  await x.update(user).set({ lastWorkspaceId: created.id }).where(eq(user.id, input.ownerId))
  return created
}

/** Gives the account the Getting started checklist unless it already has one. */
export async function startOnboarding(db: Db, userId: string): Promise<void> {
  await executor(db).update(user).set({ onboarding: {} }).where(and(eq(user.id, userId), isNull(user.onboarding)))
}

/** Workspaces with an open invitation for this address. */
export async function listInvitingWorkspaces(db: Db, email: string): Promise<string[]> {
  const rows = await executor(db)
    .select({ workspaceId: workspaceInvitation.workspaceId })
    .from(workspaceInvitation)
    .where(
      and(
        eq(workspaceInvitation.email, email),
        isNull(workspaceInvitation.acceptedAt),
        isNull(workspaceInvitation.revokedAt),
        gt(workspaceInvitation.expiresAt, new Date()),
      ),
    )
  return rows.map((row) => row.workspaceId)
}

export async function slugInUse(db: Db, slug: string, exceptWorkspaceId?: string): Promise<boolean> {
  const conditions = [eq(workspace.slug, slug)]
  if (exceptWorkspaceId) conditions.push(ne(workspace.id, exceptWorkspaceId))
  const [row] = await executor(db).select({ id: workspace.id }).from(workspace).where(and(...conditions)).limit(1)
  return Boolean(row)
}

/** Slugs that are `base` or start with `base-`. */
export async function slugsLike(db: Db, base: string, exceptWorkspaceId?: string): Promise<Set<string | null>> {
  const conditions = [or(eq(workspace.slug, base), like(workspace.slug, `${base}-%`))]
  if (exceptWorkspaceId) conditions.push(ne(workspace.id, exceptWorkspaceId))
  const rows = await executor(db).select({ slug: workspace.slug }).from(workspace).where(and(...conditions))
  return new Set(rows.map((row) => row.slug))
}

/** Oldest first. */
export function listWorkspacesWithoutSlug(db: Db) {
  return executor(db)
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(isNull(workspace.slug))
    .orderBy(asc(workspace.createdAt), asc(workspace.id))
}

export async function setWorkspaceSlug(db: Db, workspaceId: string, slug: string): Promise<void> {
  await executor(db).update(workspace).set({ slug }).where(eq(workspace.id, workspaceId))
}

/** Whether the workspace's owner is an unlimited account; null when the workspace has no row. */
export async function ownerIsUnlimited(db: Db, workspaceId: string): Promise<boolean | null> {
  const [row] = await executor(db)
    .select({ unlimited: user.unlimited })
    .from(workspace)
    .leftJoin(user, eq(user.id, workspace.ownerId))
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return row ? row.unlimited : null
}

export async function userIsUnlimited(db: Db, userId: string): Promise<boolean | null> {
  const [person] = await executor(db).select({ unlimited: user.unlimited }).from(user).where(eq(user.id, userId)).limit(1)
  return person ? person.unlimited : null
}

export async function countOwnedWorkspaces(db: Db, userId: string): Promise<number> {
  const [owned] = await executor(db).select({ value: count() }).from(workspace).where(eq(workspace.ownerId, userId))
  return owned?.value ?? 0
}

/**
 * The reports a workspace keeps: ready ones, and uploads started within the upload link's lifetime. An older
 * unfinished upload can't be seen or deleted, so it stops counting once its link expires. `except` leaves one
 * report out: the one being finalized.
 */
export async function countKeptReports(
  db: Db,
  input: { workspaceId: string; captureType: CaptureType; uploadTtlSeconds: number; now: Date; except?: string },
): Promise<number> {
  const since = new Date(input.now.getTime() - input.uploadTtlSeconds * 1000)
  const [row] = await executor(db)
    .select({ value: count() })
    .from(report)
    .where(
      and(
        eq(report.workspaceId, input.workspaceId),
        or(eq(report.uploadStatus, "ready"), and(eq(report.uploadStatus, "uploading"), gt(report.createdAt, since))),
        input.except ? ne(report.id, input.except) : undefined,
        eq(report.captureType, input.captureType),
      ),
    )
  return row?.value ?? 0
}

export async function findWorkspaceSummary(db: Db, workspaceId: string) {
  const [row] = await executor(db)
    .select({ id: workspace.id, name: workspace.name, slug: workspace.slug, logoUrl: workspace.logoUrl })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return row ?? null
}

export async function setWorkspaceLogo(db: Db, workspaceId: string, logoUrl: string | null): Promise<void> {
  await executor(db).update(workspace).set({ logoUrl }).where(eq(workspace.id, workspaceId))
}

export async function findPendingLogo(db: Db, workspaceId: string) {
  const [row] = await executor(db).select().from(pendingLogo).where(eq(pendingLogo.workspaceId, workspaceId)).limit(1)
  return row ?? null
}

export async function setPendingLogo(db: Db, workspaceId: string, logoId: string): Promise<void> {
  await executor(db)
    .insert(pendingLogo)
    .values({ workspaceId, logoId })
    .onConflictDoUpdate({ target: pendingLogo.workspaceId, set: { logoId, createdAt: new Date() } })
}

export async function deletePendingLogo(db: Db, workspaceId: string): Promise<void> {
  await executor(db).delete(pendingLogo).where(eq(pendingLogo.workspaceId, workspaceId))
}

/** Adds the person with this role unless they are already a member. */
export async function addMemberIfAbsent(db: Db, workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
  await executor(db).insert(workspaceMember).values({ workspaceId, userId, role }).onConflictDoNothing()
}
