import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { memberRole, requireMember, requireReportMember } from "../workspaces/access"
import { reportAccess } from "./access"
import { AppError, forbidden, notFound } from "../../lib/errors"
import { newShareSlug } from "../../lib/ids"
import { thumbnailKeyFor } from "../../storage/keys"
import { nearestCity } from "./cities"
import { loadReportDetail } from "./detail"
import { listReportsQuery, reportLocationBody, updateReportBody } from "./model"
import {
  deleteReport,
  findReadyReportVisibility,
  findReportFiles,
  replaceShareSlug,
  updateReport as setReportFields,
} from "./repository"
import { countReportsByStatus, listReports, updateReport } from "./service"

export function reportsModule(deps: AppDeps) {
  const { config, db, storage } = deps
  const reportNotFound = () => notFound("report_not_found", "Report not found")

  return new Elysia()
    .use(authPlugin(deps))
    .get("/reports", ({ user: current, query }) => listReports(deps, current, query), { auth: true, query: listReportsQuery })
    // The report list's status chips: how many reports each status holds under the other filters.
    .get("/reports/counts", ({ user: current, query }) => countReportsByStatus(deps, current, query), {
      auth: true,
      query: listReportsQuery,
    })
    .get(
      "/reports/:id",
      async ({ user: current, params }) => {
        await requireReportMember(db, current.id, params.id).catch(async (error: unknown) => {
          // Someone outside the workspace who may still read the report is sent to its share link.
          const row = await findReadyReportVisibility(db, { id: params.id })
          if (row && reportAccess(row, { email: current.email, isMember: false })) {
            throw new AppError(403, "use_share_link", "Open this report through its share link", { shareSlug: row.shareSlug })
          }
          throw error
        })
        const detail = await loadReportDetail(deps, { id: params.id }, { forMember: true })
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
        await setReportFields(db, params.id, { location })
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
        const shareSlug = await replaceShareSlug(db, params.id, newShareSlug())
        if (!shareSlug) throw reportNotFound()
        return { shareSlug, shareUrl: `${config.appUrl}/s/${shareSlug}` }
      },
      { auth: true },
    )
    .delete(
      "/reports/:id",
      async ({ user: current, params }) => {
        const row = await findReportFiles(db, params.id)
        if (!row || !(await memberRole(db, current.id, row.workspaceId))) throw reportNotFound()
        await requireMember(db, current.id, row.workspaceId, "admin")
        // The thumbnail key is always tried: one that arrived after finalize dropped it has no reference.
        const keys = [row.mediaKey, row.debuggerKey, thumbnailKeyFor(params.id)].filter((key): key is string => key !== null)
        await Promise.all(keys.map((key) => storage.delete(key)))
        await deleteReport(db, params.id)
        return { ok: true }
      },
      { auth: true },
    )
}
