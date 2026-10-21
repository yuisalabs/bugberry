import { integrationLabel, TRACKER_PROVIDERS } from "@bugberry/shared"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { integration, report } from "../../db/schema"
import { notFound } from "../../lib/errors"
import { createDispatcher } from "../../lib/trackers/dispatch"
import { requireReportMember } from "../../workspaces/access"
import { trackerFactoryFor } from "../../lib/trackers/default"

export function trackersModule(deps: AppDeps) {
  const { db } = deps
  const dispatcher = createDispatcher({ ...deps, trackers: trackerFactoryFor(deps) })

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/reports/:id/trackers",
      async ({ user, params }) => {
        await requireReportMember(db, user.id, params.id)
        const [row] = await db
          .select({ projectId: report.projectId })
          .from(report)
          .where(and(eq(report.id, params.id), eq(report.uploadStatus, "ready")))
          .limit(1)
        if (!row) throw notFound("report_not_found", "Report not found")
        if (!row.projectId) return { integrations: [], links: await dispatcher.linksFor(params.id), needsProject: true }
        const rows = await db
          .select()
          .from(integration)
          .where(and(eq(integration.projectId, row.projectId), inArray(integration.provider, [...TRACKER_PROVIDERS])))
          .orderBy(asc(integration.createdAt))
        return {
          integrations: rows.map((item) => ({
            id: item.id,
            provider: item.provider,
            label: integrationLabel(item.provider, item.config),
            autoSend: item.autoSend,
          })),
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
