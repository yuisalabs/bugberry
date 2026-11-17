import { and, asc, count, eq, inArray, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { project, projectGuest, user, workspace } from "../../db/schema"

/** The projects of this workspace the person is a guest of. */
export async function listGuestProjectIds(db: Db, userId: string, workspaceId: string): Promise<string[]> {
  const rows = await executor(db)
    .select({ id: projectGuest.projectId })
    .from(projectGuest)
    .innerJoin(project, eq(project.id, projectGuest.projectId))
    .where(and(eq(projectGuest.userId, userId), eq(project.workspaceId, workspaceId)))
  return rows.map((row) => row.id)
}

export async function isProjectGuest(db: Db, userId: string, projectId: string): Promise<boolean> {
  const [row] = await executor(db)
    .select({ one: sql`1` })
    .from(projectGuest)
    .where(and(eq(projectGuest.userId, userId), eq(projectGuest.projectId, projectId)))
    .limit(1)
  return row !== undefined
}

export async function isProjectGuestEmail(db: Db, projectId: string, email: string): Promise<boolean> {
  const [row] = await executor(db)
    .select({ one: sql`1` })
    .from(projectGuest)
    .innerJoin(user, eq(user.id, projectGuest.userId))
    .where(and(eq(projectGuest.projectId, projectId), eq(user.email, email)))
    .limit(1)
  return row !== undefined
}

/** The workspaces the person is a guest in, shaped like listMemberships' rows, by name. */
export function listGuestWorkspaces(db: Db, userId: string) {
  return executor(db)
    .selectDistinct({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logoUrl: workspace.logoUrl,
      role: sql<"guest">`'guest'`,
      ownerId: workspace.ownerId,
    })
    .from(projectGuest)
    .innerJoin(project, eq(project.id, projectGuest.projectId))
    .innerJoin(workspace, eq(workspace.id, project.workspaceId))
    .where(eq(projectGuest.userId, userId))
    .orderBy(asc(workspace.name), asc(workspace.id))
}

/** The workspace the person first became a guest in, or null for none. */
export async function findOldestGuestWorkspace(db: Db, userId: string): Promise<string | null> {
  const [row] = await executor(db)
    .select({ workspaceId: project.workspaceId })
    .from(projectGuest)
    .innerJoin(project, eq(project.id, projectGuest.projectId))
    .where(eq(projectGuest.userId, userId))
    .orderBy(asc(projectGuest.createdAt))
    .limit(1)
  return row?.workspaceId ?? null
}

export async function insertGuest(db: Db, row: { projectId: string; userId: string; invitedById: string | null }): Promise<void> {
  await executor(db).insert(projectGuest).values(row).onConflictDoNothing()
}

/** False when the person wasn't a guest of the project. */
export async function deleteGuest(db: Db, projectId: string, userId: string): Promise<boolean> {
  const removed = await executor(db)
    .delete(projectGuest)
    .where(and(eq(projectGuest.projectId, projectId), eq(projectGuest.userId, userId)))
    .returning({ userId: projectGuest.userId })
  return removed.length > 0
}

/** Ends being a guest anywhere in the workspace, as becoming a member does. */
export async function deleteGuestsInWorkspace(db: Db, userId: string, workspaceId: string): Promise<void> {
  await executor(db)
    .delete(projectGuest)
    .where(
      and(
        eq(projectGuest.userId, userId),
        inArray(projectGuest.projectId, executor(db).select({ id: project.id }).from(project).where(eq(project.workspaceId, workspaceId))),
      ),
    )
}

/** Holds the project's row until the transaction ends, so guest invitations to it are counted one at a time. */
export async function lockProject(db: Db, projectId: string): Promise<void> {
  await executor(db).select({ id: project.id }).from(project).where(eq(project.id, projectId)).for("update")
}

export async function countGuests(db: Db, projectId: string): Promise<number> {
  const [row] = await executor(db).select({ n: count() }).from(projectGuest).where(eq(projectGuest.projectId, projectId))
  return row?.n ?? 0
}

export function listProjectGuests(db: Db, projectId: string) {
  return executor(db)
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, since: projectGuest.createdAt })
    .from(projectGuest)
    .innerJoin(user, eq(user.id, projectGuest.userId))
    .where(eq(projectGuest.projectId, projectId))
    .orderBy(asc(user.name), asc(user.email))
}

/** Those of `userIds` who are guests of the project. */
export async function guestsAmong(db: Db, projectId: string, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = await executor(db)
    .select({ id: projectGuest.userId })
    .from(projectGuest)
    .where(and(eq(projectGuest.projectId, projectId), inArray(projectGuest.userId, [...userIds])))
  return rows.map((row) => row.id)
}

/** How many guests each project of the workspace has; projects without any are left out. */
export async function guestCountsByProject(db: Db, workspaceId: string): Promise<Map<string, number>> {
  const rows = await executor(db)
    .select({ projectId: projectGuest.projectId, n: count() })
    .from(projectGuest)
    .innerJoin(project, eq(project.id, projectGuest.projectId))
    .where(eq(project.workspaceId, workspaceId))
    .groupBy(projectGuest.projectId)
  return new Map(rows.map((row) => [row.projectId, row.n]))
}
