import { and, asc, count, desc, eq, exists, gt, gte, ilike, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { type Db, executor } from "../../db/client"
import { agentUpload, comment, project, report, user, workspace } from "../../db/schema"
import { newId } from "../../lib/ids"
import { escapeLike } from "../../lib/sql"
import { type listReportsQuery, NO_ASSIGNEE, NO_PROJECT } from "./model"

export type ReportRow = typeof report.$inferSelect
export type ListReportsInput = typeof listReportsQuery.static
/** A report by its id, or a finished one by its share link's slug. */
export type ReportKey = { id: string } | { shareSlug: string }

const reporterUser = alias(user, "reporter")
const assigneeUser = alias(user, "assignee")
const priorityRank = sql<number>`case ${report.priority}
  when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`

const keyed = (key: ReportKey) =>
  "id" in key ? eq(report.id, key.id) : and(eq(report.shareSlug, key.shareSlug), eq(report.uploadStatus, "ready"))

/**
 * A count from `debugger_summary`. The driver stores jsonb values as a JSON string scalar, so the
 * string is unwrapped first; an object (written by hand or a later driver) is read as it is.
 */
const summaryCount = (field: "errors" | "failedRequests") =>
  sql<number>`coalesce(((case when jsonb_typeof(${report.debuggerSummary}) = 'string'
    then (${report.debuggerSummary} #>> '{}')::jsonb else ${report.debuggerSummary} end) ->> ${field})::int, 0)`

/**
 * Which reports a list holds: one workspace's finished uploads, narrowed by the list's filters. The counts per
 * status leave the status filter out (`withStatus: false`), so each status chip says what picking it would show.
 */
function listConditions(db: Db, workspaceId: string, input: ListReportsInput, { withStatus = true } = {}): SQL[] {
  const conditions: SQL[] = [eq(report.workspaceId, workspaceId), eq(report.uploadStatus, "ready")]
  if (input.projectId === NO_PROJECT) conditions.push(isNull(report.projectId))
  else if (input.projectId) conditions.push(eq(report.projectId, input.projectId))
  if (input.captureType) conditions.push(eq(report.captureType, input.captureType))
  if (withStatus && input.status?.length) conditions.push(inArray(report.status, input.status))
  if (input.priority?.length) conditions.push(inArray(report.priority, input.priority))
  if (input.assigneeId === NO_ASSIGNEE) conditions.push(isNull(report.assigneeId))
  else if (input.assigneeId) conditions.push(eq(report.assigneeId, input.assigneeId))
  if (input.reporterId) conditions.push(eq(report.reporterId, input.reporterId))
  if (input.createdAfter) conditions.push(gte(report.createdAt, new Date(input.createdAfter)))
  if (input.createdBefore) conditions.push(lt(report.createdAt, new Date(input.createdBefore)))
  if (input.hasErrors) {
    const withErrors = or(gt(summaryCount("errors"), 0), gt(summaryCount("failedRequests"), 0))
    if (withErrors) conditions.push(withErrors)
  }
  const search = input.q?.trim()
  if (search) {
    const pattern = `%${escapeLike(search)}%`
    const inComments = exists(
      executor(db)
        .select({ one: sql`1` })
        .from(comment)
        .where(and(eq(comment.reportId, report.id), ilike(comment.body, pattern))),
    )
    const matches = or(ilike(report.title, pattern), ilike(report.pageUrl, pattern), ilike(report.description, pattern), inComments)
    if (matches) conditions.push(matches)
  }
  return conditions
}

/** How many of the list's reports each status holds, its status filter left out. */
export function countListByStatus(db: Db, workspaceId: string, input: ListReportsInput) {
  return executor(db)
    .select({ status: report.status, count: count() })
    .from(report)
    .where(and(...listConditions(db, workspaceId, input, { withStatus: false })))
    .groupBy(report.status)
}

/** One page of the list, sorted as asked, and how many reports the whole list holds. */
export async function listPage(db: Db, workspaceId: string, input: ListReportsInput, page: number, perPage: number) {
  const x = executor(db)
  const where = and(...listConditions(db, workspaceId, input))
  const orderBy =
    input.sort === "priority"
      ? [desc(priorityRank), desc(report.createdAt), desc(report.id)]
      : input.sort === "oldest"
        ? [asc(report.createdAt), asc(report.id)]
        : [desc(report.createdAt), desc(report.id)]
  const rows = await x
    .select({
      id: report.id,
      projectId: report.projectId,
      number: report.number,
      title: report.title,
      status: report.status,
      priority: report.priority,
      visibility: report.visibility,
      shareSlug: report.shareSlug,
      reporterDomain: report.reporterDomain,
      captureType: report.captureType,
      pageUrl: report.pageUrl,
      assigneeId: report.assigneeId,
      debuggerSummary: report.debuggerSummary,
      durationMs: report.durationMs,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      reporter: { id: reporterUser.id, name: reporterUser.name, image: reporterUser.image },
      mediaKey: report.mediaKey,
      mediaType: report.mediaType,
      thumbnailKey: report.thumbnailKey,
    })
    .from(report)
    .innerJoin(reporterUser, eq(report.reporterId, reporterUser.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage)
  const [totals] = await x.select({ total: count() }).from(report).where(where)
  return { rows, total: totals?.total ?? 0 }
}

/** The report with its reporter and assignee, for the report page and the share page. */
export async function findDetailRow(db: Db, key: ReportKey) {
  const [row] = await executor(db)
    .select({
      report,
      reporter: { id: reporterUser.id, name: reporterUser.name, image: reporterUser.image, email: reporterUser.email },
      assignee: { id: assigneeUser.id, name: assigneeUser.name, image: assigneeUser.image },
    })
    .from(report)
    .innerJoin(reporterUser, eq(report.reporterId, reporterUser.id))
    .leftJoin(assigneeUser, eq(report.assigneeId, assigneeUser.id))
    .where(keyed(key))
    .limit(1)
  return row ?? null
}

/** Who may see a finished report: its workspace, visibility and reporter's domain, and its share slug. */
export async function findReadyReportVisibility(db: Db, key: ReportKey) {
  const [row] = await executor(db)
    .select({
      workspaceId: report.workspaceId,
      visibility: report.visibility,
      reporterDomain: report.reporterDomain,
      shareSlug: report.shareSlug,
    })
    .from(report)
    .where("id" in key ? and(eq(report.id, key.id), eq(report.uploadStatus, "ready")) : keyed(key))
    .limit(1)
  return row ?? null
}

export async function findReport(db: Db, reportId: string): Promise<ReportRow | null> {
  const [row] = await executor(db).select().from(report).where(eq(report.id, reportId)).limit(1)
  return row ?? null
}

/** The fields whose changes go into the report's activity, as they are now. */
export async function findLoggedFields(db: Db, reportId: string) {
  const [row] = await executor(db)
    .select({ status: report.status, priority: report.priority, assigneeId: report.assigneeId, title: report.title })
    .from(report)
    .where(eq(report.id, reportId))
    .limit(1)
  return row ?? null
}

/** Changes a finished report; false when there is none. */
export async function updateReadyReport(
  db: Db,
  reportId: string,
  changes: Partial<typeof report.$inferInsert>,
): Promise<boolean> {
  const updated = await executor(db)
    .update(report)
    .set(changes)
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
    .returning({ id: report.id })
  return updated.length > 0
}

export async function updateReport(db: Db, reportId: string, changes: Partial<typeof report.$inferInsert>): Promise<void> {
  await executor(db).update(report).set(changes).where(eq(report.id, reportId))
}

/** A new share slug for the report; null when there is no such report. */
export async function replaceShareSlug(db: Db, reportId: string, shareSlug: string): Promise<string | null> {
  const [updated] = await executor(db)
    .update(report)
    .set({ shareSlug })
    .where(eq(report.id, reportId))
    .returning({ shareSlug: report.shareSlug })
  return updated?.shareSlug ?? null
}

export async function deleteReport(db: Db, reportId: string): Promise<void> {
  await executor(db).delete(report).where(eq(report.id, reportId))
}

/**
 * Takes the workspace's next report number. The update locks the workspace row until the
 * caller's transaction ends, so two uploads at once never get the same number.
 */
export async function claimReportNumber(db: Db, workspaceId: string): Promise<number> {
  const [row] = await executor(db)
    .update(workspace)
    .set({ nextReportNumber: sql`${workspace.nextReportNumber} + 1` })
    .where(eq(workspace.id, workspaceId))
    .returning({ next: workspace.nextReportNumber })
  if (!row) throw new Error("Workspace not found")
  return row.next - 1
}

/** Locks the workspace row until the transaction ends, as claimReportNumber does. */
export async function lockWorkspaceForReports(db: Db, workspaceId: string): Promise<void> {
  await executor(db).select({ id: workspace.id }).from(workspace).where(eq(workspace.id, workspaceId)).for("update")
}

export async function insertReport(db: Db, values: typeof report.$inferInsert) {
  const [row] = await executor(db)
    .insert(report)
    .values(values)
    .returning({ id: report.id, shareSlug: report.shareSlug, number: report.number })
  return row ?? null
}

/** The report's media upload in parts, with its row locked until the transaction ends. */
export async function lockMediaUpload(db: Db, reportId: string): Promise<string | null> {
  const [locked] = await executor(db)
    .select({ mediaUploadId: report.mediaUploadId })
    .from(report)
    .where(eq(report.id, reportId))
    .for("update")
  return locked?.mediaUploadId ?? null
}

/** Makes an uploading report ready; false when it was not uploading any more. */
export async function markUploadReady(db: Db, reportId: string, keepThumbnail: boolean): Promise<boolean> {
  const updated = await executor(db)
    .update(report)
    .set({
      uploadStatus: "ready",
      uploadError: null,
      ...(keepThumbnail ? {} : { thumbnailKey: null, thumbnailSize: null }),
    })
    // Only from uploading: of two finalizes at the same time, one makes the report ready.
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "uploading")))
    .returning({ id: report.id })
  return updated.length > 0
}

export async function findUploadState(db: Db, reportId: string) {
  const [row] = await executor(db)
    .select({ uploadStatus: report.uploadStatus, uploadError: report.uploadError })
    .from(report)
    .where(eq(report.id, reportId))
  return row ?? null
}

/** Reports that never became visible, still uploading or failed, created before `olderThan`. */
export function listStaleUploads(db: Db, olderThan: Date) {
  return executor(db)
    .select({ id: report.id, mediaKey: report.mediaKey, debuggerKey: report.debuggerKey })
    .from(report)
    .where(and(inArray(report.uploadStatus, ["uploading", "failed"]), lt(report.createdAt, olderThan)))
}

export async function insertAgentUpload(db: Db, values: Omit<typeof agentUpload.$inferInsert, "id">): Promise<void> {
  await executor(db).insert(agentUpload).values({ id: newId(), ...values })
}

export async function findAgentUpload(db: Db, tokenHash: string) {
  const [ticket] = await executor(db).select().from(agentUpload).where(eq(agentUpload.tokenHash, tokenHash)).limit(1)
  return ticket ?? null
}

export async function markAgentUploadFinalized(db: Db, ticketId: string): Promise<void> {
  await executor(db).update(agentUpload).set({ finalizedAt: new Date() }).where(eq(agentUpload.id, ticketId))
}

export async function deleteExpiredAgentUploads(db: Db, before: Date): Promise<void> {
  await executor(db).delete(agentUpload).where(lt(agentUpload.expiresAt, before))
}

/** A finished report by its id, its share slug, or its number in a workspace. */
export async function findReadyReportByRef(
  db: Db,
  ref: { id: string } | { shareSlug: string } | { workspaceId: string; number: number },
): Promise<ReportRow | null> {
  const ready = eq(report.uploadStatus, "ready")
  const where =
    "id" in ref
      ? and(eq(report.id, ref.id), ready)
      : "shareSlug" in ref
        ? and(eq(report.shareSlug, ref.shareSlug), ready)
        : and(eq(report.workspaceId, ref.workspaceId), eq(report.number, ref.number), ready)
  const [row] = await executor(db).select().from(report).where(where).limit(1)
  return row ?? null
}

/** The workspace's slug, and the name and slug of the project when it is one of the workspace's, in one read. */
export async function findReportPlace(db: Db, workspaceId: string, projectId: string | null) {
  const [place] = await executor(db)
    .select({ projectName: project.name, projectSlug: project.slug, workspaceSlug: workspace.slug })
    .from(workspace)
    .leftJoin(project, and(eq(project.id, projectId ?? ""), eq(project.workspaceId, workspace.id)))
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return place ?? null
}
