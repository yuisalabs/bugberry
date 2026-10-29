import { type ConnectionSettings, type IntegrationConfig, type IntegrationProvider, targetLabel, type UseTarget } from "@bugberry/shared"
import type { Db } from "../../db/client"
import { findUseRow, listUseRows, type UseRow } from "./repository"

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

function resolved({ settings, ...row }: UseRow): ResolvedUse {
  return {
    ...row,
    config: { ...(settings as ConnectionSettings), ...row.target } as IntegrationConfig,
    label: targetLabel(row.provider, row.target) ?? row.connectionName,
  }
}

export async function loadUse(db: Db, integrationId: string): Promise<ResolvedUse | null> {
  const row = await findUseRow(db, integrationId)
  return row ? resolved(row) : null
}

export async function usesOfProject(db: Db, projectId: string, providers: readonly IntegrationProvider[]): Promise<ResolvedUse[]> {
  return (await listUseRows(db, projectId, providers)).map(resolved)
}
