import type { IntegrationProvider } from "@bugberry/shared"
import { and, eq, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { report, reportExternalLink } from "../../db/schema"
import { newId } from "../../lib/ids"

const linkColumns = {
  integrationId: reportExternalLink.integrationId,
  provider: reportExternalLink.provider,
  externalId: reportExternalLink.externalId,
  externalUrl: reportExternalLink.externalUrl,
  error: reportExternalLink.error,
  updatedAt: reportExternalLink.updatedAt,
}

const sameLink = (reportId: string, integrationId: string) =>
  and(eq(reportExternalLink.reportId, reportId), eq(reportExternalLink.integrationId, integrationId))

export async function findLink(db: Db, reportId: string, integrationId: string) {
  const [row] = await executor(db).select(linkColumns).from(reportExternalLink).where(sameLink(reportId, integrationId)).limit(1)
  return row ?? null
}

export function listLinks(db: Db, reportId: string) {
  return executor(db).select(linkColumns).from(reportExternalLink).where(eq(reportExternalLink.reportId, reportId))
}

/**
 * Takes the (report, integration) row as a lock. Returns the claim's timestamp, which identifies
 * this sender, or null when the link is sent or being sent. Timestamps come from the database clock,
 * the same one the 2-minute lease is measured against, cut to milliseconds so they survive the trip
 * through a JavaScript Date.
 */
export async function claimLink(db: Db, reportId: string, integrationId: string, provider: IntegrationProvider): Promise<Date | null> {
  const databaseNow = sql<Date>`date_trunc('milliseconds', now())`
  const [claimed] = await executor(db)
    .insert(reportExternalLink)
    .values({ id: newId(), reportId, integrationId, provider, updatedAt: databaseNow })
    .onConflictDoUpdate({
      target: [reportExternalLink.reportId, reportExternalLink.integrationId],
      set: { error: null, updatedAt: databaseNow },
      setWhere: sql`${reportExternalLink.externalId} is null and (${reportExternalLink.error} is not null or ${reportExternalLink.updatedAt} < now() - interval '2 minutes')`,
    })
    .returning({ updatedAt: reportExternalLink.updatedAt })
  return claimed?.updatedAt ?? null
}

/** Writes a send's result while the claim made at `claimedAt` still holds; false when it was taken over. */
export async function finishLink(
  db: Db,
  reportId: string,
  integrationId: string,
  claimedAt: Date,
  values: Partial<typeof reportExternalLink.$inferInsert>,
): Promise<boolean> {
  const updated = await executor(db)
    .update(reportExternalLink)
    .set({ ...values, updatedAt: sql`now()` })
    .where(and(sameLink(reportId, integrationId), eq(reportExternalLink.updatedAt, claimedAt)))
    .returning({ id: reportExternalLink.id })
  return updated.length > 0
}

export async function findReadyReport(db: Db, reportId: string) {
  const [row] = await executor(db)
    .select()
    .from(report)
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
    .limit(1)
  return row ?? null
}

/** The report's project; `readyOnly` leaves out unfinished uploads. Undefined when there is no such report. */
export async function findReportProject(db: Db, reportId: string, readyOnly: boolean): Promise<{ projectId: string | null } | undefined> {
  const [row] = await executor(db)
    .select({ projectId: report.projectId })
    .from(report)
    .where(readyOnly ? and(eq(report.id, reportId), eq(report.uploadStatus, "ready")) : eq(report.id, reportId))
    .limit(1)
  return row
}
