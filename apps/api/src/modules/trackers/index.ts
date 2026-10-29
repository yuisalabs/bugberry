import { TRACKER_PROVIDERS } from "@bugberry/shared"
import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { usesOfProject } from "../integrations/resolve"
import { notFound } from "../../lib/errors"
import { createDispatcher } from "./dispatch"
import { requireReportMember } from "../workspaces/access"
import { trackerFactoryFor } from "./default"
import { findReportProject } from "./repository"

export function trackersModule(deps: AppDeps) {
  const { db } = deps
  const dispatcher = createDispatcher({ ...deps, trackers: trackerFactoryFor(deps) })

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/reports/:id/trackers",
      async ({ user, params }) => {
        await requireReportMember(db, user.id, params.id)
        const row = await findReportProject(db, params.id, true)
        if (!row) throw notFound("report_not_found", "Report not found")
        if (!row.projectId) return { integrations: [], links: await dispatcher.linksFor(params.id), needsProject: true }
        const uses = await usesOfProject(db, row.projectId, TRACKER_PROVIDERS)
        return {
          integrations: uses.map((item) => ({ id: item.id, provider: item.provider, label: item.label, autoSend: item.autoSend })),
          links: await dispatcher.linksFor(params.id),
          needsProject: false,
        }
      },
      { auth: true },
    )
    .post(
      "/reports/:id/trackers/:integrationId/send",
      async ({ user, params }) => {
        await requireReportMember(db, user.id, params.id)
        return dispatcher.send(params.id, params.integrationId, { actorId: user.id, viaAgent: null })
      },
      { auth: true },
    )
}
