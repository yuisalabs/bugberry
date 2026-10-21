import { and, eq, sql } from "drizzle-orm"
import type { Config } from "../../config"
import type { Db } from "../../db/client"
import { integration, report, reportExternalLink } from "../../db/schema"
import type { StorageDriver } from "../../storage/types"
import { AppError, conflict, notFound, unprocessable } from "../errors"
import { newId } from "../ids"
import { createSecretBox, SECRET_UNREADABLE } from "../secret-box"
import { buildIssueContent } from "./content"
import { type ActivityActor, recordActivity } from "../../modules/activity/service"
import { readTopErrors } from "./debugger-errors"
import { type TrackerFactory, TrackerError } from "./providers"

export interface TrackerLink {
  integrationId: string
  externalId: string | null
  externalUrl: string | null
  error: string | null
  updatedAt: Date
}

const linkColumns = {
  integrationId: reportExternalLink.integrationId,
  externalId: reportExternalLink.externalId,
  externalUrl: reportExternalLink.externalUrl,
  error: reportExternalLink.error,
  updatedAt: reportExternalLink.updatedAt,
}

export function createDispatcher(deps: { config: Config; db: Db; storage: StorageDriver; trackers: TrackerFactory }) {
  const { db } = deps
  const box = createSecretBox(deps.config.encryptionKey)
  const sameLink = (reportId: string, integrationId: string) =>
    and(eq(reportExternalLink.reportId, reportId), eq(reportExternalLink.integrationId, integrationId))

  const loadLink = async (reportId: string, integrationId: string): Promise<TrackerLink | null> => {
    const [row] = await db.select(linkColumns).from(reportExternalLink).where(sameLink(reportId, integrationId)).limit(1)
    return row ?? null
  }

  /**
   * Takes the (report, integration) row as a lock. Returns the claim's timestamp, which identifies
   * this sender, or null when the link is sent or being sent. Timestamps come from the database clock,
   * the same one the 2-minute lease is measured against, cut to milliseconds so they survive the trip
   * through a JavaScript Date.
   */
  const claim = async (reportId: string, integrationId: string): Promise<Date | null> => {
    const databaseNow = sql<Date>`date_trunc('milliseconds', now())`
    const [claimed] = await db
      .insert(reportExternalLink)
      .values({ id: newId(), reportId, integrationId, updatedAt: databaseNow })
      .onConflictDoUpdate({
        target: [reportExternalLink.reportId, reportExternalLink.integrationId],
        set: { error: null, updatedAt: databaseNow },
        setWhere: sql`${reportExternalLink.externalId} is null and (${reportExternalLink.error} is not null or ${reportExternalLink.updatedAt} < now() - interval '2 minutes')`,
      })
      .returning({ updatedAt: reportExternalLink.updatedAt })
    return claimed?.updatedAt ?? null
  }

  /** `by` is who pressed Send, for the report's activity; null for an automatic send. */
  async function send(reportId: string, integrationId: string, by: ActivityActor | null = null): Promise<TrackerLink> {
    const [row] = await db
      .select()
      .from(report)
      .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
      .limit(1)
    if (!row) throw notFound("report_not_found", "Report not found")
    // Integrations belong to projects, so a report outside every project has none to send to.
    if (!row.projectId) {
      throw unprocessable("report_has_no_project", "Add the report to a project before sending it to a tracker")
    }
    const [target] = await db
      .select()
      .from(integration)
      .where(and(eq(integration.id, integrationId), eq(integration.projectId, row.projectId)))
      .limit(1)
    if (!target) throw notFound("integration_not_found", "Integration not found")

    // Built before claiming, so only the bounded tracker request runs while the link is locked.
    const errors = row.debuggerKey ? await readTopErrors(deps.storage, row.debuggerKey) : []
    const content = buildIssueContent(row, errors, deps.config.appUrl)

    const claimedAt = await claim(reportId, integrationId)
    if (!claimedAt) {
      const existing = await loadLink(reportId, integrationId)
      if (existing?.externalId) return existing
      throw conflict("send_in_progress", "This report is already being sent to that tracker")
    }

    /** Writes the result only while this sender still owns the claim; a takeover's result wins. */
    const finish = async (values: Partial<typeof reportExternalLink.$inferInsert>): Promise<TrackerLink> => {
      const updated = await db
        .update(reportExternalLink)
        .set({ ...values, updatedAt: sql`now()` })
        .where(and(sameLink(reportId, integrationId), eq(reportExternalLink.updatedAt, claimedAt)))
        .returning({ id: reportExternalLink.id })
      if (updated.length === 0) console.error("tracker send lost its claim", { reportId, integrationId, ...values })
      const link = await loadLink(reportId, integrationId)
      if (link) return link
      // The link row goes with its report or its integration; say which one is gone.
      const [stillThere] = await db
        .select({ id: integration.id })
        .from(integration)
        .where(eq(integration.id, integrationId))
        .limit(1)
      throw stillThere
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
      const issue = await deps.trackers(target.provider, target.config, secret).createIssue(content)
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
    const [row] = await db.select({ projectId: report.projectId }).from(report).where(eq(report.id, reportId)).limit(1)
    if (!row?.projectId) return
    const targets = await db
      .select({ id: integration.id })
      .from(integration)
      .where(and(eq(integration.projectId, row.projectId), eq(integration.autoSend, true)))
    for (const target of targets) {
      try {
        await send(reportId, target.id)
      } catch (error) {
        if (!(error instanceof AppError && error.code === "send_in_progress")) console.error("auto-send failed", error)
      }
    }
  }

  async function linksFor(reportId: string): Promise<TrackerLink[]> {
    return db.select(linkColumns).from(reportExternalLink).where(eq(reportExternalLink.reportId, reportId))
  }

  return { send, autoSend, linksFor }
}
