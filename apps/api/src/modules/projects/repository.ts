import { and, asc, count, desc, eq, max, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { pendingProjectLogo, project, report } from "../../db/schema"
import { newId } from "../../lib/ids"

export type ProjectRow = typeof project.$inferSelect
type ProjectFields = Pick<typeof project.$inferInsert, "name" | "slug" | "urlPatterns">

/** Another project of the workspace with this slug, if any. */
export async function findProjectBySlug(db: Db, workspaceId: string, slug: string): Promise<string | null> {
  const [existing] = await executor(db)
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.slug, slug)))
    .limit(1)
  return existing?.id ?? null
}

/** By name. */
export function listProjects(db: Db, workspaceId: string) {
  return executor(db).select().from(project).where(eq(project.workspaceId, workspaceId)).orderBy(asc(project.name))
}

export async function findProject(db: Db, projectId: string): Promise<ProjectRow | null> {
  const [row] = await executor(db).select().from(project).where(eq(project.id, projectId)).limit(1)
  return row ?? null
}

export async function insertProject(db: Db, workspaceId: string, fields: ProjectFields): Promise<ProjectRow> {
  const [created] = await executor(db).insert(project).values({ id: newId(), workspaceId, ...fields }).returning()
  if (!created) throw new Error("Failed to create project")
  return created
}

export async function updateProject(
  db: Db,
  projectId: string,
  changes: Partial<ProjectFields> & { logoUrl?: string | null },
): Promise<ProjectRow | null> {
  const [updated] = await executor(db).update(project).set(changes).where(eq(project.id, projectId)).returning()
  return updated ?? null
}

/** The deleted project's logo link, or null when there was no such project. */
export async function deleteProject(db: Db, projectId: string): Promise<{ logoUrl: string | null } | null> {
  const [deleted] = await executor(db).delete(project).where(eq(project.id, projectId)).returning({ logoUrl: project.logoUrl })
  return deleted ?? null
}

export async function projectHasReports(db: Db, projectId: string): Promise<boolean> {
  const [used] = await executor(db).select({ id: report.id }).from(report).where(eq(report.projectId, projectId)).limit(1)
  return used !== undefined
}

/** Each project's URL patterns, for matching pages. */
export function listProjectPatterns(db: Db, workspaceId: string) {
  return executor(db).select({ id: project.id, urlPatterns: project.urlPatterns }).from(project).where(eq(project.workspaceId, workspaceId))
}

const ready = (workspaceId: string) => and(eq(report.workspaceId, workspaceId), eq(report.uploadStatus, "ready"))

/** Finished reports per project: how many, how many open, and the newest. */
export function reportStatsByProject(db: Db, workspaceId: string) {
  return executor(db)
    .select({
      projectId: report.projectId,
      reports: count(),
      open: sql<number>`count(*) filter (where ${report.status} = 'open')`.mapWith(Number),
      lastReportAt: max(report.createdAt),
    })
    .from(report)
    .where(ready(workspaceId))
    .groupBy(report.projectId)
}

/** One row per address and project; the newest addresses first, so a huge workspace still sees its recent pages. */
export function reportPagesByProject(db: Db, workspaceId: string) {
  return executor(db)
    .select({ pageUrl: report.pageUrl, projectId: report.projectId, reports: count(), lastReportAt: max(report.createdAt) })
    .from(report)
    .where(ready(workspaceId))
    .groupBy(report.pageUrl, report.projectId)
    .orderBy(desc(max(report.createdAt)))
    .limit(5000)
}

export async function findPendingProjectLogo(db: Db, projectId: string) {
  const [row] = await executor(db).select().from(pendingProjectLogo).where(eq(pendingProjectLogo.projectId, projectId)).limit(1)
  return row ?? null
}

export async function setPendingProjectLogo(db: Db, projectId: string, logoId: string): Promise<void> {
  await executor(db)
    .insert(pendingProjectLogo)
    .values({ projectId, logoId })
    .onConflictDoUpdate({ target: pendingProjectLogo.projectId, set: { logoId, createdAt: new Date() } })
}

export async function deletePendingProjectLogo(db: Db, projectId: string): Promise<void> {
  await executor(db).delete(pendingProjectLogo).where(eq(pendingProjectLogo.projectId, projectId))
}
