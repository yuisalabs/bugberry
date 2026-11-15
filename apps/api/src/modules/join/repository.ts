import { and, asc, count, eq, notInArray } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { joinRequest, user, workspace, workspaceMember } from "../../db/schema"

/** What the join page shows of a workspace. */
export async function findWorkspaceCard(db: Db, workspaceId: string) {
  const x = executor(db)
  const [row] = await x
    .select({ id: workspace.id, name: workspace.name, logoUrl: workspace.logoUrl })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  if (!row) return null
  const [members] = await x.select({ value: count() }).from(workspaceMember).where(eq(workspaceMember.workspaceId, workspaceId))
  return { ...row, memberCount: members?.value ?? 0 }
}

/** The workspace whose share code this is, as stored ("7KX-29QF"). */
export async function findWorkspaceByShareCode(db: Db, shareCode: string): Promise<string | null> {
  const [row] = await executor(db).select({ id: workspace.id }).from(workspace).where(eq(workspace.shareCode, shareCode)).limit(1)
  return row?.id ?? null
}

/** How people can get into the workspace without an invitation. */
export async function findJoinSettings(db: Db, workspaceId: string) {
  const [row] = await executor(db)
    .select({ shareCode: workspace.shareCode, joinDomain: workspace.joinDomain, joinMode: workspace.joinMode })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return row ?? null
}

export async function updateJoinSettings(
  db: Db,
  workspaceId: string,
  changes: { shareCode?: string | null; joinDomain?: string | null; joinMode?: "direct" | "approval" },
): Promise<void> {
  await executor(db).update(workspace).set(changes).where(eq(workspace.id, workspaceId))
}

/** The workspace, when its join domain is this one. */
export async function findDomainWorkspace(db: Db, workspaceId: string, domain: string) {
  const [row] = await executor(db)
    .select({ id: workspace.id, joinMode: workspace.joinMode })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.joinDomain, domain)))
    .limit(1)
  return row ?? null
}

/** Workspaces taking people with this email domain that the person is not in yet, by name. */
export function listDomainWorkspacesNotJoined(db: Db, domain: string, userId: string) {
  const x = executor(db)
  const mine = x.select({ id: workspaceMember.workspaceId }).from(workspaceMember).where(eq(workspaceMember.userId, userId))
  return x
    .select({ id: workspace.id, joinMode: workspace.joinMode })
    .from(workspace)
    .where(and(eq(workspace.joinDomain, domain), notInArray(workspace.id, mine)))
    .orderBy(asc(workspace.name))
}

/** The workspaces the person asked to join. */
export async function listRequestedWorkspaces(db: Db, userId: string): Promise<string[]> {
  const rows = await executor(db).select({ id: joinRequest.workspaceId }).from(joinRequest).where(eq(joinRequest.userId, userId))
  return rows.map((row) => row.id)
}

export async function insertJoinRequest(db: Db, workspaceId: string, userId: string): Promise<void> {
  await executor(db).insert(joinRequest).values({ workspaceId, userId }).onConflictDoNothing()
}

export async function deleteJoinRequest(db: Db, workspaceId: string, userId: string): Promise<void> {
  await executor(db).delete(joinRequest).where(and(eq(joinRequest.workspaceId, workspaceId), eq(joinRequest.userId, userId)))
}

/** Removes the request; true when there was one. */
export async function takeJoinRequest(db: Db, workspaceId: string, userId: string): Promise<boolean> {
  const removed = await executor(db)
    .delete(joinRequest)
    .where(and(eq(joinRequest.workspaceId, workspaceId), eq(joinRequest.userId, userId)))
    .returning({ userId: joinRequest.userId })
  return removed.length > 0
}

/** Who is waiting to join, oldest request first. */
export function listJoinRequests(db: Db, workspaceId: string) {
  return executor(db)
    .select({ user: { id: user.id, name: user.name, email: user.email, image: user.image }, createdAt: joinRequest.createdAt })
    .from(joinRequest)
    .innerJoin(user, eq(user.id, joinRequest.userId))
    .where(eq(joinRequest.workspaceId, workspaceId))
    .orderBy(asc(joinRequest.createdAt))
}
