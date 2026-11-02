import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { addFixBody, listReportsQuery, reportLocationBody, resolveReportBody, updateReportBody } from "./model"
import { addFix, removeFix, resolveReport } from "./fixes"
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
    .post("/reports/:id/fixes", ({ user: current, params, body }) => addFix(deps, current, params.id, body.url), {
      auth: true,
      body: addFixBody,
    })
    .delete("/reports/:id/fixes/:fixId", ({ user: current, params }) => removeFix(deps, current, params.id, params.fixId), { auth: true })
    // Resolving with a link tells the reporter; changing the status with PATCH doesn't.
    .post("/reports/:id/resolve", ({ user: current, params, body }) => resolveReport(deps, current, params.id, body), {
      auth: true,
      body: resolveReportBody,
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
