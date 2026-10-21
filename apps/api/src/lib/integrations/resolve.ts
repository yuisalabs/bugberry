import { type ConnectionSettings, type IntegrationConfig, type IntegrationProvider, targetLabel, type UseTarget } from "@bugberry/shared"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { Db } from "../../db/client"
import { connection, integration } from "../../db/schema"

/** A project's use of a connection, with what the provider clients need: the merged config and the sealed secret. */
export interface ResolvedUse {
  id: string
  projectId: string
  provider: IntegrationProvider
  connectionId: string
  connectionName: string
  target: UseTarget
  /** The connection's settings with the use's target on top, the shape the tracker and notifier clients take. */
  config: IntegrationConfig
  secretEncrypted: string
  autoSend: boolean
  lastError: string | null
  lastDeliveredAt: Date | null
  createdAt: Date
  /** The target as people read it, or the connection's name when there is no target. */
  label: string
}

const columns = {
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

type Row = {
  [K in keyof typeof columns]: (typeof columns)[K]["_"]["notNull"] extends true
    ? (typeof columns)[K]["_"]["data"]
    : (typeof columns)[K]["_"]["data"] | null
}

function resolved({ settings, ...row }: Row): ResolvedUse {
  return {
    ...row,
    config: { ...(settings as ConnectionSettings), ...row.target } as IntegrationConfig,
    label: targetLabel(row.provider, row.target) ?? row.connectionName,
  }
}

export async function loadUse(db: Db, integrationId: string): Promise<ResolvedUse | null> {
  const [row] = await db
    .select(columns)
    .from(integration)
    .innerJoin(connection, eq(connection.id, integration.connectionId))
    .where(eq(integration.id, integrationId))
    .limit(1)
  return row ? resolved(row) : null
}

export async function usesOfProject(db: Db, projectId: string, providers: readonly IntegrationProvider[]): Promise<ResolvedUse[]> {
  const rows = await db
    .select(columns)
    .from(integration)
    .innerJoin(connection, eq(connection.id, integration.connectionId))
    .where(and(eq(integration.projectId, projectId), inArray(integration.provider, [...providers])))
    .orderBy(asc(integration.createdAt))
  return rows.map(resolved)
}
