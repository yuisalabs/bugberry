import { and, asc, count, desc, eq, exists, gte, ilike, inArray, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm"
import { alias, union, unionAll } from "drizzle-orm/pg-core"
import { type Db, executor } from "../../db/client"
import { agentUpload, comment, notification, project, report, reportFix, type ReportFixRow, reportLabel, user, workspace } from "../../db/schema"
import { newId } from "../../lib/ids"
import { escapeLike } from "../../lib/sql"
import type { ListCursor, ListSort } from "./cursor"
import { type listReportsQuery, NO_ASSIGNEE, NO_PROJECT } from "./model"

export type ReportRow = typeof report.$inferSelect
export type ListReportsInput = typeof listReportsQuery.static
/** A report by its id, or a finished one by its share link's slug. */
export type ReportKey = { id: string } | { shareSlug: string }

const reporterUser = alias(user, "reporter")
const assigneeUser = alias(user, "assignee")
const keyed = (key: ReportKey) =>
  "id" in key ? eq(report.id, key.id) : and(eq(report.shareSlug, key.shareSlug), eq(report.uploadStatus, "ready"))

/**
 * Which reports a list holds before its search: one workspace's finished uploads, narrowed by the list's filters. The
 * counts per status leave the status filter out (`withStatus: false`), so each status chip says what picking it would show.
 */
function listFilters(workspaceId: string, input: ListReportsInput, { withStatus = true } = {}): SQL[] {
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
  if (input.hasErrors) conditions.push(eq(report.hasErrors, true))
  if (input.labelId?.length) {
    // Walks report_label_label_idx from each label to its reports.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${reportLabel} WHERE ${reportLabel.reportId} = ${report.id} AND ${inArray(reportLabel.labelId, input.labelId)})`,
    )
  }
  return conditions
}

function searchPattern(input: ListReportsInput): string | null {
  const search = input.q?.trim()
  return search ? `%${escapeLike(search)}%` : null
}

const inOwnText = (pattern: string) => or(ilike(report.title, pattern), ilike(report.pageUrl, pattern), ilike(report.description, pattern))

/**
 * Every report of the workspace the search matches, by its own text or by a comment, for counting them. The two ways
 * are separate queries because one `OR … EXISTS` condition cannot read the trigram indexes. `report` in here is the
 * subquery's own rows, not the query's around it.
 */
function allMatches(db: Db, workspaceId: string, pattern: string) {
  const x = executor(db)
  return union(
    x.select({ id: report.id }).from(report).where(and(eq(report.workspaceId, workspaceId), inOwnText(pattern))),
    x
      .select({ id: comment.reportId })
      .from(comment)
      .innerJoin(report, eq(report.id, comment.reportId))
      .where(and(eq(report.workspaceId, workspaceId), ilike(comment.body, pattern))),
  )
}

/**
 * The first `limit` matches of each way in the list's order; a page of `limit` reports is among them. Each half
 * stops once it has enough, where collecting every match first takes a second for a word most reports hold.
 * `filters` and `orderBy` name `report`, which in here is each half's own rows.
 */
function topMatches(db: Db, filters: SQL[], pattern: string, orderBy: SQL[], limit: number) {
  const x = executor(db)
  const inAComment = exists(
    x
      .select({ one: sql`1` })
      .from(comment)
      .where(and(eq(comment.reportId, report.id), ilike(comment.body, pattern))),
  )
  const top = (matches: SQL | undefined) =>
    x
      .select({ id: report.id })
      .from(report)
      .where(and(...filters, matches))
      .orderBy(...orderBy)
      .limit(limit)
  return unionAll(top(inOwnText(pattern)), top(inAComment))
}

/** How many of the list's reports each status holds, its status filter left out. */
export function countListByStatus(db: Db, workspaceId: string, input: ListReportsInput) {
  const pattern = searchPattern(input)
  return executor(db)
    .select({ status: report.status, count: count() })
    .from(report)
    .where(
      and(
        ...listFilters(workspaceId, input, { withStatus: false }),
        pattern ? inArray(report.id, allMatches(db, workspaceId, pattern)) : undefined,
      ),
    )
    .groupBy(report.status)
}

/** `created_at` with its microseconds, as a cursor carries it. */
const createdAtText = sql<string>`to_char(${report.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** The list's order for a sort, and which reports come after `after` in it. Every order ends in the id, so no two reports tie. */
function listOrder(sort: ListSort, after: ListCursor | null): { orderBy: SQL[]; position: SQL | undefined } {
  const at = after && sql`${after.createdAt}::timestamptz`
  if (sort === "priority") {
    return {
      // The enum was created from none up to critical, so its own order is the rank.
      orderBy: [desc(report.priority), desc(report.createdAt), desc(report.id)],
      position: after ? sql`(${report.priority}, ${report.createdAt}, ${report.id}) < (${after.priority}::priority, ${at}, ${after.id})` : undefined,
    }
  }
  if (sort === "oldest") {
    return {
      orderBy: [asc(report.createdAt), asc(report.id)],
      position: after ? sql`(${report.createdAt}, ${report.id}) > (${at}, ${after.id})` : undefined,
    }
  }
  return {
    orderBy: [desc(report.createdAt), desc(report.id)],
    position: after ? sql`(${report.createdAt}, ${report.id}) < (${at}, ${after.id})` : undefined,
  }
}

/**
 * The `perPage` reports after `after` in the list's order (from its start when null), and where the page after
 * this one starts. It reads one report more than it returns to know whether there is such a page.
 */
export async function listPage(db: Db, workspaceId: string, input: ListReportsInput, perPage: number, after: ListCursor | null) {
  const sort: ListSort = input.sort ?? "newest"
  const { orderBy, position } = listOrder(sort, after)
  const conditions = listFilters(workspaceId, input)
  if (position) conditions.push(position)
  const pattern = searchPattern(input)
  const found = await executor(db)
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
      createdAtText,
    })
    .from(report)
    .innerJoin(reporterUser, eq(report.reporterId, reporterUser.id))
    .where(pattern ? inArray(report.id, topMatches(db, conditions, pattern, orderBy, perPage + 1)) : and(...conditions))
    .orderBy(...orderBy)
    .limit(perPage + 1)
  const rows = found.slice(0, perPage).map(({ createdAtText: at, ...row }) => ({ row, at }))
  const last = found.length > perPage ? rows.at(-1) : undefined
  const next: ListCursor | null = last
    ? { sort, createdAt: last.at, id: last.row.id, ...(sort === "priority" ? { priority: last.row.priority } : {}) }
    : null
  return { rows: rows.map(({ row }) => row), next }
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

/** A public, finished report's link preview; null for anything else, so the caller can't tell which. */
export async function findSharePreview(db: Db, shareSlug: string) {
  const [row] = await executor(db)
    .select({
      number: report.number,
      title: report.title,
      captureType: report.captureType,
      pageUrl: report.pageUrl,
      debuggerSummary: report.debuggerSummary,
      thumbnailKey: report.thumbnailKey,
    })
    .from(report)
    .where(and(eq(report.shareSlug, shareSlug), eq(report.uploadStatus, "ready"), eq(report.visibility, "public")))
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
    .select({ id: report.id, mediaKey: report.mediaKey, debuggerKey: report.debuggerKey, replayFrames: report.replayFrames })
    .from(report)
    .where(and(inArray(report.uploadStatus, ["uploading", "failed"]), lt(report.createdAt, olderThan)))
}

export async function insertAgentUpload(db: Db, values: Omit<typeof agentUpload.$inferInsert, "id">): Promise<void> {
  await executor(db).insert(agentUpload).values({ id: newId(), ...values })
}

/** The link's token is its only credential, so the account behind it is checked here: none for a deactivated one. */
export async function findAgentUpload(db: Db, tokenHash: string) {
  const [row] = await executor(db)
    .select({ ticket: agentUpload })
    .from(agentUpload)
    .innerJoin(user, eq(user.id, agentUpload.userId))
    .where(and(eq(agentUpload.tokenHash, tokenHash), isNull(user.deactivatedAt)))
    .limit(1)
  return row?.ticket ?? null
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

export async function findReportReporter(db: Db, reportId: string): Promise<string | null> {
  const [row] = await executor(db).select({ reporterId: report.reporterId }).from(report).where(eq(report.id, reportId)).limit(1)
  return row?.reporterId ?? null
}

/** The report's stored files and its workspace, for deleting it. */
export async function findReportFiles(db: Db, reportId: string) {
  const [row] = await executor(db)
    .select({
      id: report.id,
      mediaKey: report.mediaKey,
      debuggerKey: report.debuggerKey,
      replayFrames: report.replayFrames,
      workspaceId: report.workspaceId,
    })
    .from(report)
    .where(eq(report.id, reportId))
    .limit(1)
  return row ?? null
}

export function listReportFixes(db: Db, reportId: string): Promise<ReportFixRow[]> {
  return executor(db).select().from(reportFix).where(eq(reportFix.reportId, reportId)).orderBy(asc(reportFix.createdAt), asc(reportFix.id))
}

/** Fix links of several reports, for the bell. */
export function listFixesOf(db: Db, reportIds: string[]): Promise<ReportFixRow[]> {
  if (reportIds.length === 0) return Promise.resolve([])
  return executor(db).select().from(reportFix).where(inArray(reportFix.reportId, reportIds)).orderBy(asc(reportFix.createdAt), asc(reportFix.id))
}

/** The new row, or null when that URL is already on the report. */
export async function insertFix(
  db: Db,
  values: { reportId: string; url: string; addedBy: string; viaAgent: string | null },
): Promise<ReportFixRow | null> {
  const [row] = await executor(db)
    .insert(reportFix)
    .values({ id: newId(), ...values })
    .onConflictDoNothing({ target: [reportFix.reportId, reportFix.url] })
    .returning()
  return row ?? null
}

export async function deleteFix(db: Db, reportId: string, fixId: string): Promise<ReportFixRow | null> {
  const [row] = await executor(db)
    .delete(reportFix)
    .where(and(eq(reportFix.id, fixId), eq(reportFix.reportId, reportId)))
    .returning()
  return row ?? null
}

export async function findReportStatus(db: Db, reportId: string) {
  const [row] = await executor(db).select({ status: report.status }).from(report).where(eq(report.id, reportId)).limit(1)
  return row?.status ?? null
}

/** True only for the call that changed it: a concurrent one waits on the row lock, then matches nothing. */
/** Until the transaction ends, other writers to this report's fix links wait here. */
export async function lockReport(db: Db, reportId: string): Promise<void> {
  await executor(db).select({ id: report.id }).from(report).where(eq(report.id, reportId)).for("update")
}

export async function markResolved(db: Db, reportId: string): Promise<boolean> {
  const rows = await executor(db)
    .update(report)
    .set({ status: "resolved" })
    .where(and(eq(report.id, reportId), ne(report.status, "resolved")))
    .returning({ id: report.id })
  return rows.length > 0
}

export async function insertResolvedNotification(
  db: Db,
  values: { userId: string; reportId: string; actorId: string; viaAgent: string | null },
): Promise<string> {
  const id = newId()
  await executor(db)
    .insert(notification)
    .values({ id, kind: "resolved", commentId: null, ...values })
  return id
}

export async function attachResolvedNote(db: Db, notificationId: string, commentId: string): Promise<void> {
  await executor(db).update(notification).set({ noteCommentId: commentId }).where(eq(notification.id, notificationId))
}
