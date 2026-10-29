import type { Config } from "../../config"
import type { Db } from "../../db/client"
import type { reportExternalLink } from "../../db/schema"
import type { StorageDriver } from "../../storage/types"
import { AppError, conflict, notFound, unprocessable } from "../../lib/errors"
import { createSecretBox, SECRET_UNREADABLE } from "../../lib/secret-box"
import { buildIssueContent } from "./content"
import { recordActivity } from "../activity/repository"
import type { ActivityActor } from "../activity/service"
import { readTopErrors } from "./debugger-errors"
import { type TrackerFactory, TrackerError } from "./providers"
import { type IntegrationProvider, isTrackerProvider, type TrackerConfig } from "@bugberry/shared"
import { integrationExists, listAutoSendTrackers } from "../integrations/repository"
import { loadUse } from "../integrations/resolve"
import { claimLink, findLink, findReadyReport, findReportProject, finishLink, listLinks } from "./repository"

export interface TrackerLink {
  /** Null once the use that sent it is gone; the link and its issue stay. */
  integrationId: string | null
  provider: IntegrationProvider | null
  externalId: string | null
  externalUrl: string | null
  error: string | null
  updatedAt: Date
}

export function createDispatcher(deps: { config: Config; db: Db; storage: StorageDriver; trackers: TrackerFactory }) {
  const { db } = deps
  const box = createSecretBox(deps.config.encryptionKey)

  /** `by` is who pressed Send, for the report's activity; null for an automatic send. */
  async function send(reportId: string, integrationId: string, by: ActivityActor | null = null): Promise<TrackerLink> {
    const row = await findReadyReport(db, reportId)
    if (!row) throw notFound("report_not_found", "Report not found")
    // Integrations belong to projects, so a report outside every project has none to send to.
    if (!row.projectId) {
      throw unprocessable("report_has_no_project", "Add the report to a project before sending it to a tracker")
    }
    const target = await loadUse(db, integrationId)
    // A use of another project, or a notification channel (no tracker): from here it does not exist.
    if (!target || target.projectId !== row.projectId || !isTrackerProvider(target.provider)) {
      throw notFound("integration_not_found", "Integration not found")
    }

    // Built before claiming, so only the bounded tracker request runs while the link is locked.
    const errors = row.debuggerKey ? await readTopErrors(deps.storage, row.debuggerKey) : []
    const content = buildIssueContent(row, errors, deps.config.appUrl)

    const claimedAt = await claimLink(db, reportId, integrationId, target.provider)
    if (!claimedAt) {
      const existing = await findLink(db, reportId, integrationId)
      if (existing?.externalId) return existing
      throw conflict("send_in_progress", "This report is already being sent to that tracker")
    }

    /** Writes the result only while this sender still owns the claim; a takeover's result wins. */
    const finish = async (values: Partial<typeof reportExternalLink.$inferInsert>): Promise<TrackerLink> => {
      if (!(await finishLink(db, reportId, integrationId, claimedAt, values))) {
        console.error("tracker send lost its claim", { reportId, integrationId, ...values })
      }
      const link = await findLink(db, reportId, integrationId)
      if (link) return link
      // The link row goes with its report or its integration; say which one is gone.
      throw (await integrationExists(db, integrationId))
        ? notFound("report_not_found", "Report not found")
        : notFound("integration_not_found", "Integration not found")
    }

    let secret: string
    try {
      secret = box.open(target.secretEncrypted)
    } catch {
      return finish({ error: SECRET_UNREADABLE })
    }
    try {
      const issue = await deps.trackers(target.provider, target.config as TrackerConfig, secret).createIssue(content)
      const link = await finish({ externalId: issue.externalId, externalUrl: issue.url, error: null })
      await recordActivity(db, {
        reportId,
        kind: "tracker",
        // Marked rather than inferred from a missing person: older sends were never stored with who sent them.
        detail: { provider: target.provider, externalId: issue.externalId, externalUrl: issue.url, ...(by ? {} : { automatic: true }) },
        actorId: by?.actorId ?? null,
        viaAgent: by?.viaAgent ?? null,
      }).catch((error) => console.error("tracker activity failed", error))
      return link
    } catch (error) {
      return finish({ error: error instanceof TrackerError ? error.message : "Could not send to the tracker" })
    }
  }

  /** Sends a just-finalized report to every auto-send integration of its project. */
  async function autoSend(reportId: string): Promise<void> {
    const row = await findReportProject(db, reportId, false)
    if (!row?.projectId) return
    for (const target of await listAutoSendTrackers(db, row.projectId)) {
      try {
        await send(reportId, target)
      } catch (error) {
        if (!(error instanceof AppError && error.code === "send_in_progress")) console.error("auto-send failed", error)
      }
    }
  }

  async function linksFor(reportId: string): Promise<TrackerLink[]> {
    return listLinks(db, reportId)
  }

  return { send, autoSend, linksFor }
}
