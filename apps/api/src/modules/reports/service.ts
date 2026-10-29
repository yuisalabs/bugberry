import { FREE_EMAIL_DOMAINS, REPORT_STATUSES, type ReportStatus, THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import type { AppDeps } from "../../deps"
import type { CurrentUser } from "../../plugins/auth"
import { badRequest, forbidden, notFound, unprocessable } from "../../lib/errors"
import { newShareSlug } from "../../lib/ids"
import { memberRole, requireReportMember, resolveWorkspace } from "../workspaces/access"
import { recordActivity } from "../activity/repository"
import { projectInWorkspace } from "../projects/repository"
import { loadReportDetail, type ReportDetail } from "./detail"
import type { updateReportBody } from "./model"
import { countListByStatus, findLoggedFields, type ListReportsInput, listPage, updateReadyReport } from "./repository"

const DEFAULT_PER_PAGE = 20

export type { ListReportsInput } from "./repository"
export type UpdateReportInput = typeof updateReportBody.static
type Deps = Pick<AppDeps, "db" | "storage">

const reportNotFound = () => notFound("report_not_found", "Report not found")

/** How many reports each status holds under the list's other filters, and all of them together. */
export async function countReportsByStatus({ db }: Deps, caller: CurrentUser, input: ListReportsInput) {
  const workspaceId = await resolveWorkspace(db, caller, input.workspaceId)
  const rows = await countListByStatus(db, workspaceId, input)
  const byStatus = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0])) as Record<ReportStatus, number>
  for (const row of rows) byStatus[row.status] = row.count
  return { total: rows.reduce((sum, row) => sum + row.count, 0), byStatus }
}

/** The report list a member sees in one workspace: finished uploads only, filtered, sorted and paged. */
export async function listReports({ db, storage }: Deps, caller: CurrentUser, input: ListReportsInput) {
  const workspaceId = await resolveWorkspace(db, caller, input.workspaceId)
  const page = input.page ?? 1
  const perPage = input.perPage ?? DEFAULT_PER_PAGE
  const { rows, total } = await listPage(db, workspaceId, input, page, perPage)
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

  return { items, page, perPage, total }
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
    if (!(await projectInWorkspace(db, input.projectId, target.workspaceId))) {
      throw unprocessable("project_not_found", "Project not found in this workspace")
    }
  }
  // Leaving public retires the link that went around; workspace and internal links stay as they are.
  const retiresLink = input.visibility !== undefined && input.visibility !== "public" && target.visibility === "public"
  const before = await findLoggedFields(db, reportId)
  const changes = retiresLink ? { ...input, shareSlug: newShareSlug() } : input
  if (!(await updateReadyReport(db, reportId, changes))) throw reportNotFound()
  for (const [field, kind] of LOGGED_FIELDS) {
    const to = input[field]
    const from = before?.[field]
    if (to === undefined || to === from) continue
    await recordActivity(db, { reportId, kind, detail: { from: from ?? null, to }, actorId: caller.id, viaAgent: opts.viaAgent ?? null })
  }
  const detail = await loadReportDetail(deps, { id: reportId }, { forMember: true })
  if (!detail) throw reportNotFound()
  return detail
}
