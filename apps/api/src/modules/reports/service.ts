import { FREE_EMAIL_DOMAINS, REPORT_STATUSES, type ReportStatus, THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import { and, asc, count, desc, eq, exists, gt, gte, ilike, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { AppDeps } from "../../deps"
import type { CurrentUser } from "../../plugins/auth"
import { comment, project, report, user } from "../../db/schema"
import { badRequest, forbidden, notFound, unprocessable } from "../../lib/errors"
import { newShareSlug } from "../../lib/ids"
import { escapeLike } from "../../lib/sql"
import { memberRole, requireReportMember, resolveWorkspace } from "../workspaces/access"
import { recordActivity } from "../activity/repository"
import { loadReportDetail, type ReportDetail } from "./detail"
import { type listReportsQuery, NO_ASSIGNEE, NO_PROJECT, type updateReportBody } from "./model"

const DEFAULT_PER_PAGE = 20
const reporterUser = alias(user, "reporter")
const priorityRank = sql<number>`case ${report.priority}
  when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`

export type ListReportsInput = typeof listReportsQuery.static
export type UpdateReportInput = typeof updateReportBody.static
type Deps = Pick<AppDeps, "db" | "storage">

/**
 * A count from `debugger_summary`. The driver stores jsonb values as a JSON string scalar, so the
 * string is unwrapped first; an object (written by hand or a later driver) is read as it is.
 */
const summaryCount = (field: "errors" | "failedRequests") =>
  sql<number>`coalesce(((case when jsonb_typeof(${report.debuggerSummary}) = 'string'
    then (${report.debuggerSummary} #>> '{}')::jsonb else ${report.debuggerSummary} end) ->> ${field})::int, 0)`

const reportNotFound = () => notFound("report_not_found", "Report not found")

/**
 * Which reports a list holds: one workspace's finished uploads, narrowed by the list's filters. The counts per
 * status leave the status filter out (`withStatus: false`), so each status chip says what picking it would show.
 */
function reportConditions(db: Deps["db"], workspaceId: string, input: ListReportsInput, { withStatus = true } = {}): SQL[] {
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
      db
        .select({ one: sql`1` })
        .from(comment)
        .where(and(eq(comment.reportId, report.id), ilike(comment.body, pattern))),
    )
    const matches = or(ilike(report.title, pattern), ilike(report.pageUrl, pattern), ilike(report.description, pattern), inComments)
    if (matches) conditions.push(matches)
  }
  return conditions
}

/** How many reports each status holds under the list's other filters, and all of them together. */
export async function countReportsByStatus({ db }: Deps, caller: CurrentUser, input: ListReportsInput) {
  const workspaceId = await resolveWorkspace(db, caller, input.workspaceId)
  const rows = await db
    .select({ status: report.status, count: count() })
    .from(report)
    .where(and(...reportConditions(db, workspaceId, input, { withStatus: false })))
    .groupBy(report.status)
  const byStatus = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0])) as Record<ReportStatus, number>
  for (const row of rows) byStatus[row.status] = row.count
  return { total: rows.reduce((sum, row) => sum + row.count, 0), byStatus }
}

/** The report list a member sees in one workspace: finished uploads only, filtered, sorted and paged. */
export async function listReports({ db, storage }: Deps, caller: CurrentUser, input: ListReportsInput) {
  const workspaceId = await resolveWorkspace(db, caller, input.workspaceId)
  const page = input.page ?? 1
  const perPage = input.perPage ?? DEFAULT_PER_PAGE
  const where = and(...reportConditions(db, workspaceId, input))
  const orderBy =
    input.sort === "priority"
      ? [desc(priorityRank), desc(report.createdAt), desc(report.id)]
      : input.sort === "oldest"
        ? [asc(report.createdAt), asc(report.id)]
        : [desc(report.createdAt), desc(report.id)]

  const rows = await db
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
  const [totals] = await db.select({ total: count() }).from(report).where(where)
  // Cards show the uploaded thumbnail; an older screenshot shows itself, an older video nothing.
  const items = await Promise.all(
    rows.map(async ({ mediaKey, mediaType, thumbnailKey, reporterDomain, ...item }) => ({
      ...item,
      // The card's Copy link says who can open it, like the report page.
      internalDomain: reporterDomain && !FREE_EMAIL_DOMAINS.has(reporterDomain) ? reporterDomain : null,
      thumbnailUrl: thumbnailKey
        ? await storage.getReadUrl(thumbnailKey, { contentType: THUMBNAIL_CONTENT_TYPE })
        : item.captureType === "screenshot"
          ? await storage.getReadUrl(mediaKey, { contentType: mediaType })
          : null,
    })),
  )

  return { items, page, perPage, total: totals?.total ?? 0 }
}

export type ReportListItem = Awaited<ReturnType<typeof listReports>>["items"][number]

/** The fields whose changes show in the report's activity, and the activity kind each one records. */
const LOGGED_FIELDS = [
  ["status", "status"],
  ["priority", "priority"],
  ["assigneeId", "assignee"],
  ["title", "title"],
] as const

/**
 * Changes a report as a member, with the same rules as the report page. Status, priority, assignee and title
 * changes go into the report's activity; `viaAgent` names the AI app when the change came through MCP.
 */
export async function updateReport(
  deps: Deps,
  caller: CurrentUser,
  reportId: string,
  input: UpdateReportInput,
  opts: { viaAgent?: string } = {},
): Promise<ReportDetail> {
  const { db } = deps
  const target = await requireReportMember(db, caller.id, reportId)
  if (Object.values(input).every((value) => value === undefined)) {
    throw badRequest("empty_update", "Nothing to update")
  }
  if (input.visibility !== undefined) {
    // Who sees a report outside its workspace is the reporter's call, or an admin's.
    if (target.reporterId !== caller.id && target.role !== "admin") {
      throw forbidden("Only the reporter or an admin can change who sees this report")
    }
    if (input.visibility === "internal" && (!target.reporterDomain || FREE_EMAIL_DOMAINS.has(target.reporterDomain))) {
      throw unprocessable("internal_unavailable", "Internal sharing needs a company email domain")
    }
  }
  if (input.assigneeId && !(await memberRole(db, input.assigneeId, target.workspaceId))) {
    throw unprocessable("assignee_not_found", "Assignee is not in this workspace")
  }
  if (input.projectId) {
    const [inWorkspace] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, input.projectId), eq(project.workspaceId, target.workspaceId)))
      .limit(1)
    if (!inWorkspace) throw unprocessable("project_not_found", "Project not found in this workspace")
  }
  // Leaving public retires the link that went around; workspace and internal links stay as they are.
  const retiresLink = input.visibility !== undefined && input.visibility !== "public" && target.visibility === "public"
  const [before] = await db
    .select({ status: report.status, priority: report.priority, assigneeId: report.assigneeId, title: report.title })
    .from(report)
    .where(eq(report.id, reportId))
    .limit(1)
  const updated = await db
    .update(report)
    .set(retiresLink ? { ...input, shareSlug: newShareSlug() } : input)
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
    .returning({ id: report.id })
  if (updated.length === 0) throw reportNotFound()
  for (const [field, kind] of LOGGED_FIELDS) {
    const to = input[field]
    const from = before?.[field]
    if (to === undefined || to === from) continue
    await recordActivity(db, { reportId, kind, detail: { from: from ?? null, to }, actorId: caller.id, viaAgent: opts.viaAgent ?? null })
  }
  const detail = await loadReportDetail(deps, eq(report.id, reportId), { forMember: true })
  if (!detail) throw reportNotFound()
  return detail
}
