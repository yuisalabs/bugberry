import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { listReportsQuery, reportLocationBody, updateReportBody } from "./model"
import {
  countReportsByStatus,
  listReports,
  openReport,
  regenerateShareLink,
  removeReport,
  setReportLocation,
  updateReport,
} from "./service"

export function reportsModule(deps: AppDeps) {
  const { config, db } = deps

  return new Elysia()
    .use(authPlugin(deps))
    .get("/reports", ({ user: current, query }) => listReports(deps, current, query), { auth: true, query: listReportsQuery })
    // The report list's status chips: how many reports each status holds under the other filters.
    .get("/reports/counts", ({ user: current, query }) => countReportsByStatus(deps, current, query), {
      auth: true,
      query: listReportsQuery,
    })
    .get("/reports/:id", ({ user: current, params }) => openReport(deps, current, params.id), { auth: true })
    .patch("/reports/:id", ({ user: current, params, body }) => updateReport(deps, current, params.id, body), {
      auth: true,
      body: updateReportBody,
    })
    .post(
      "/reports/:id/location",
      ({ user: current, params, body }) => setReportLocation(db, current, params.id, body.latitude, body.longitude),
      { auth: true, body: reportLocationBody },
    )
    .post("/reports/:id/share/regenerate", ({ user: current, params }) => regenerateShareLink(db, config.appUrl, current, params.id), {
      auth: true,
    })
    .delete("/reports/:id", ({ user: current, params }) => removeReport(deps, current, params.id), { auth: true })
}
