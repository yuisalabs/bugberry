import { type IntegrationProvider, TRACKER_PROVIDERS } from "@bugberry/shared"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { connection, integration, project, report, user } from "../../db/schema"

const useColumns = {
  id: integration.id,
  projectId: integration.projectId,
  provider: integration.provider,
  connectionId: integration.connectionId,
  connectionName: connection.name,
  target: integration.config,
  settings: connection.settings,
  secretEncrypted: connection.secretEncrypted,
  autoSend: integration.autoSend,
  lastError: integration.lastError,
  lastDeliveredAt: integration.lastDeliveredAt,
  createdAt: integration.createdAt,
}

/** A use of a connection with the connection's name, settings and sealed secret. */
export type UseRow = {
  [K in keyof typeof useColumns]: (typeof useColumns)[K]["_"]["notNull"] extends true
    ? (typeof useColumns)[K]["_"]["data"]
    : (typeof useColumns)[K]["_"]["data"] | null
}

export async function findUseRow(db: Db, integrationId: string): Promise<UseRow | null> {
  const [row] = await executor(db)
    .select(useColumns)
    .from(integration)
    .innerJoin(connection, eq(connection.id, integration.connectionId))
    .where(eq(integration.id, integrationId))
    .limit(1)
  return row ?? null
}

/** Oldest first. */
export function listUseRows(db: Db, projectId: string, providers: readonly IntegrationProvider[]): Promise<UseRow[]> {
  return executor(db)
    .select(useColumns)
    .from(integration)
    .innerJoin(connection, eq(connection.id, integration.connectionId))
    .where(and(eq(integration.projectId, projectId), inArray(integration.provider, [...providers])))
    .orderBy(asc(integration.createdAt))
}

export async function insertIntegration(db: Db, values: typeof integration.$inferInsert): Promise<void> {
  await executor(db).insert(integration).values(values)
}

export async function updateIntegration(db: Db, integrationId: string, changes: Partial<typeof integration.$inferInsert>): Promise<void> {
  await executor(db).update(integration).set(changes).where(eq(integration.id, integrationId))
}

export async function deleteIntegration(db: Db, integrationId: string): Promise<void> {
  await executor(db).delete(integration).where(eq(integration.id, integrationId))
}

export async function integrationExists(db: Db, integrationId: string): Promise<boolean> {
  const [row] = await executor(db).select({ id: integration.id }).from(integration).where(eq(integration.id, integrationId)).limit(1)
  return row !== undefined
}

/** A channel's last delivery: the error, or none; `delivered` also stamps the delivery time (database clock). */
export async function recordDelivery(db: Db, integrationId: string, lastError: string | null, delivered: boolean): Promise<void> {
  await executor(db)
    .update(integration)
    .set({ lastError, ...(delivered ? { lastDeliveredAt: sql`now()` } : {}) })
    .where(eq(integration.id, integrationId))
}

/** The project's trackers that get every new report. */
export async function listAutoSendTrackers(db: Db, projectId: string): Promise<string[]> {
  const rows = await executor(db)
    .select({ id: integration.id })
    .from(integration)
    .where(and(eq(integration.projectId, projectId), eq(integration.autoSend, true), inArray(integration.provider, [...TRACKER_PROVIDERS])))
  return rows.map((row) => row.id)
}

/** What a new-report message says: the finished report, its project and who reported it. */
export async function findReportForChannels(db: Db, reportId: string) {
  const [row] = await executor(db)
    .select({
      id: report.id,
      number: report.number,
      title: report.title,
      pageUrl: report.pageUrl,
      device: report.device,
      debuggerSummary: report.debuggerSummary,
      createdAt: report.createdAt,
      projectId: project.id,
      projectName: project.name,
      reporterName: user.name,
    })
    .from(report)
    .innerJoin(project, eq(project.id, report.projectId))
    .innerJoin(user, eq(user.id, report.reporterId))
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
    .limit(1)
  return row ?? null
}
