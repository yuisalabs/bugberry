import { FREE_EMAIL_DOMAINS, THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { memberRole, requireMember, requireReportMember, resolveWorkspace } from "../../workspaces/access"
import { reportAccess } from "../../workspaces/report-access"
import { project, report, user } from "../../db/schema"
import { AppError, badRequest, forbidden, notFound, unprocessable } from "../../lib/errors"
import { newShareSlug } from "../../lib/ids"
import { escapeLike } from "../../lib/sql"
import { thumbnailKeyFor } from "../../storage/keys"
import { nearestCity } from "../../lib/cities"
import { loadReportDetail } from "./detail"
import { listReportsQuery, NO_PROJECT, reportLocationBody, updateReportBody } from "./model"

const DEFAULT_PER_PAGE = 20
const reporterUser = alias(user, "reporter")
const priorityRank = sql<number>`case ${report.priority}
  when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`

export function reportsModule(deps: AppDeps) {
  const { config, db, storage } = deps
  const reportNotFound = () => notFound("report_not_found", "Report not found")

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/reports",
      async ({ user: current, query }) => {
        const workspaceId = await resolveWorkspace(db, current, query.workspaceId)
        const page = query.page ?? 1
        const perPage = query.perPage ?? DEFAULT_PER_PAGE
        const conditions: SQL[] = [eq(report.workspaceId, workspaceId), eq(report.uploadStatus, "ready")]
        if (query.projectId === NO_PROJECT) conditions.push(isNull(report.projectId))
        else if (query.projectId) conditions.push(eq(report.projectId, query.projectId))
        if (query.captureType) conditions.push(eq(report.captureType, query.captureType))
        if (query.status?.length) conditions.push(inArray(report.status, query.status))
        if (query.priority?.length) conditions.push(inArray(report.priority, query.priority))
        if (query.assigneeId) conditions.push(eq(report.assigneeId, query.assigneeId))
        if (query.reporterId) conditions.push(eq(report.reporterId, query.reporterId))
        const search = query.q?.trim()
        if (search) {
          const pattern = `%${escapeLike(search)}%`
          const matches = or(ilike(report.title, pattern), ilike(report.pageUrl, pattern))
          if (matches) conditions.push(matches)
        }
        const where = and(...conditions)
        const orderBy =
          query.sort === "priority"
            ? [desc(priorityRank), desc(report.createdAt), desc(report.id)]
            : query.sort === "oldest"
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
      },
      { auth: true, query: listReportsQuery },
    )
    .get(
      "/reports/:id",
      async ({ user: current, params }) => {
        await requireReportMember(db, current.id, params.id).catch(async (error: unknown) => {
          // Someone outside the workspace who may still read the report is sent to its share link.
          const [row] = await db
            .select({
              workspaceId: report.workspaceId,
              visibility: report.visibility,
              reporterDomain: report.reporterDomain,
              shareSlug: report.shareSlug,
            })
            .from(report)
            .where(and(eq(report.id, params.id), eq(report.uploadStatus, "ready")))
            .limit(1)
          if (row && reportAccess(row, { email: current.email, isMember: false })) {
            throw new AppError(403, "use_share_link", "Open this report through its share link", { shareSlug: row.shareSlug })
          }
          throw error
        })
        const detail = await loadReportDetail(deps, eq(report.id, params.id), { forMember: true })
        if (!detail) throw reportNotFound()
        return detail
      },
      { auth: true },
    )
    .patch(
      "/reports/:id",
      async ({ user: current, params, body }) => {
        const target = await requireReportMember(db, current.id, params.id)
        if (Object.values(body).every((value) => value === undefined)) {
          throw badRequest("empty_update", "Nothing to update")
        }
        if (body.visibility !== undefined) {
          // Who sees a report outside its workspace is the reporter's call, or an admin's.
          if (target.reporterId !== current.id && target.role !== "admin") {
            throw forbidden("Only the reporter or an admin can change who sees this report")
          }
          if (body.visibility === "internal" && (!target.reporterDomain || FREE_EMAIL_DOMAINS.has(target.reporterDomain))) {
            throw unprocessable("internal_unavailable", "Internal sharing needs a company email domain")
          }
        }
        if (body.assigneeId && !(await memberRole(db, body.assigneeId, target.workspaceId))) {
          throw unprocessable("assignee_not_found", "Assignee is not in this workspace")
        }
        if (body.projectId) {
          const [inWorkspace] = await db
            .select({ id: project.id })
            .from(project)
            .where(and(eq(project.id, body.projectId), eq(project.workspaceId, target.workspaceId)))
            .limit(1)
          if (!inWorkspace) throw unprocessable("project_not_found", "Project not found in this workspace")
        }
        // Leaving public retires the link that went around; workspace and internal links stay as they are.
        const retiresLink = body.visibility !== undefined && body.visibility !== "public" && target.visibility === "public"
        const updated = await db
          .update(report)
          .set(retiresLink ? { ...body, shareSlug: newShareSlug() } : body)
          .where(and(eq(report.id, params.id), eq(report.uploadStatus, "ready")))
          .returning({ id: report.id })
        if (updated.length === 0) throw reportNotFound()
        const detail = await loadReportDetail(deps, eq(report.id, params.id), { forMember: true })
        if (!detail) throw reportNotFound()
        return detail
      },
      { auth: true, body: updateReportBody },
    )
    .post(
      "/reports/:id/location",
      async ({ user: current, params, body }) => {
        const target = await requireReportMember(db, current.id, params.id)
        if (target.reporterId !== current.id) throw forbidden("Only the reporter can add their location")
        // The coordinates live only in this request: the report keeps the city name, nothing finer.
        const location = nearestCity(body.latitude, body.longitude)
        await db.update(report).set({ location }).where(eq(report.id, params.id))
        return { location }
      },
      { auth: true, body: reportLocationBody },
    )
    .post(
      "/reports/:id/share/regenerate",
      async ({ user: current, params }) => {
        const target = await requireReportMember(db, current.id, params.id)
        if (target.reporterId !== current.id && target.role !== "admin") {
          throw forbidden("Only the reporter or an admin can reset this link")
        }
        const [updated] = await db
          .update(report)
          .set({ shareSlug: newShareSlug() })
          .where(eq(report.id, params.id))
          .returning({ shareSlug: report.shareSlug })
        if (!updated) throw reportNotFound()
        return { shareSlug: updated.shareSlug, shareUrl: `${config.appUrl}/s/${updated.shareSlug}` }
      },
      { auth: true },
    )
    .delete(
      "/reports/:id",
      async ({ user: current, params }) => {
        const [row] = await db
          .select({ mediaKey: report.mediaKey, debuggerKey: report.debuggerKey, workspaceId: report.workspaceId })
          .from(report)
          .where(eq(report.id, params.id))
          .limit(1)
        if (!row || !(await memberRole(db, current.id, row.workspaceId))) throw reportNotFound()
        await requireMember(db, current.id, row.workspaceId, "admin")
        // The thumbnail key is always tried: one that arrived after finalize dropped it has no reference.
        const keys = [row.mediaKey, row.debuggerKey, thumbnailKeyFor(params.id)].filter((key): key is string => key !== null)
        await Promise.all(keys.map((key) => storage.delete(key)))
        await db.delete(report).where(eq(report.id, params.id))
        return { ok: true }
      },
      { auth: true },
    )
}
