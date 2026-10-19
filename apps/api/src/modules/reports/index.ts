import { and, eq } from "drizzle-orm"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { memberRole, requireMember, requireReportMember } from "../../workspaces/access"
import { reportAccess } from "../../workspaces/report-access"
import { report } from "../../db/schema"
import { AppError, forbidden, notFound } from "../../lib/errors"
import { newShareSlug } from "../../lib/ids"
import { thumbnailKeyFor } from "../../storage/keys"
import { nearestCity } from "../../lib/cities"
import { loadReportDetail } from "./detail"
import { listReportsQuery, reportLocationBody, updateReportBody } from "./model"
import { listReports, updateReport } from "./service"

export function reportsModule(deps: AppDeps) {
  const { config, db, storage } = deps
  const reportNotFound = () => notFound("report_not_found", "Report not found")

  return new Elysia()
    .use(authPlugin(deps))
    .get("/reports", ({ user: current, query }) => listReports(deps, current, query), { auth: true, query: listReportsQuery })
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
    .patch("/reports/:id", ({ user: current, params, body }) => updateReport(deps, current, params.id, body), {
      auth: true,
      body: updateReportBody,
    })
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
