import { type ConnectionSettings, integrationKind, isTrackerProvider, type NotifierConfig } from "@bugberry/shared"
import type { AppDeps } from "../../deps"
import type { connection } from "../../db/schema"
import { conflict, notFound, unprocessable } from "../../lib/errors"
import { createHostGuard } from "../../lib/net/host-guard"
import { createSecretBox, SECRET_UNREADABLE, SecretError } from "../../lib/secret-box"
import { notifierFactoryFor } from "../notifiers/deliver"
import { testMessage } from "../notifiers/message"
import { TrackerError } from "../trackers/providers"
import { findWorkspaceName } from "../workspaces/repository"
import { accountFactoryFor, ListUnavailableError } from "./accounts"
import type { createBody, optionsQuery, patchBody } from "./model"
import {
  type ConnectionRow,
  deleteConnection,
  findConnection,
  insertConnection,
  listConnections,
  listConnectionUses,
  updateConnection,
} from "./repository"
import { checkAddresses, checkWebhookSecret, normalizeSettings } from "./validate"

interface UseRow {
  connectionId: string
  projectId: string
  projectName: string
  lastError: string | null
  lastDeliveredAt: Date | null
  updatedAt: Date
}

/** What anyone in the workspace sees of a connection: never its settings or secret. */
function memberView(row: ConnectionRow, uses: UseRow[]) {
  const failing = uses.filter((use) => use.lastError).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  const delivered = uses.map((use) => use.lastDeliveredAt).filter((date): date is Date => date !== null)
  return {
    id: row.id,
    provider: row.provider,
    kind: integrationKind(row.provider),
    name: row.name,
    usedIn: new Set(uses.map((use) => use.projectId)).size,
    status: {
      failing: failing.length,
      lastError: failing[0]?.lastError ?? null,
      lastDeliveredAt: delivered.length ? new Date(Math.max(...delivered.map((date) => date.getTime()))) : null,
    },
  }
}

/** Admins also see the settings and which projects use it (for the delete confirmation). */
function adminView(row: ConnectionRow, uses: UseRow[]) {
  const projects = new Map(uses.map((use) => [use.projectId, use.projectName]))
  return {
    ...memberView(row, uses),
    settings: row.settings,
    usedBy: [...projects].map(([projectId, projectName]) => ({ projectId, projectName })),
  }
}

/** A workspace's accounts and channels: settings checked, secrets sealed, and tested against the provider. */
export function createConnectionsService(deps: Pick<AppDeps, "config" | "db" | "accounts" | "notifiers">) {
  const { db } = deps
  const box = createSecretBox(deps.config.encryptionKey)
  const notifiers = notifierFactoryFor(deps)
  const accounts = accountFactoryFor(deps)
  const guard = createHostGuard({ allowPrivate: deps.config.allowPrivateIntegrationHosts })

  const usesOf = async (ids: string[]): Promise<UseRow[]> => (ids.length === 0 ? [] : listConnectionUses(db, ids))
  const find = async (workspaceId: string, id: string) => {
    const row = await findConnection(db, workspaceId, id)
    if (!row) throw notFound("connection_not_found", "Connection not found")
    return row
  }
  const openSecret = (row: ConnectionRow) => {
    try {
      return box.open(row.secretEncrypted)
    } catch (error) {
      if (error instanceof SecretError) throw conflict("secret_unreadable", SECRET_UNREADABLE)
      throw error
    }
  }

  return {
    async list(workspaceId: string, role: "admin" | "member") {
      const rows = await listConnections(db, workspaceId)
      const uses = await usesOf(rows.map((row) => row.id))
      const view = role === "admin" ? adminView : memberView
      return rows.map((row) => view(row, uses.filter((use) => use.connectionId === row.id)))
    },

    async create(workspaceId: string, body: typeof createBody.static) {
      const settings = normalizeSettings(body.provider, body.settings)
      const plain = body.secret?.trim() ?? ""
      checkWebhookSecret(body.provider, plain)
      await checkAddresses(guard, settings)
      const created = await insertConnection(db, {
        workspaceId,
        provider: body.provider,
        name: body.name.trim(),
        settings,
        secretEncrypted: box.seal(plain),
      })
      return adminView(created, [])
    },

    async change(workspaceId: string, connectionId: string, body: typeof patchBody.static) {
      const row = await find(workspaceId, connectionId)
      const changes: Partial<typeof connection.$inferInsert> = {}
      if (body.name !== undefined) changes.name = body.name.trim()
      if (body.settings) {
        changes.settings = normalizeSettings(row.provider, body.settings) as ConnectionSettings
        await checkAddresses(guard, changes.settings)
      }
      if (body.secret?.trim()) {
        checkWebhookSecret(row.provider, body.secret.trim())
        changes.secretEncrypted = box.seal(body.secret.trim())
      }
      const updated = Object.keys(changes).length === 0 ? row : await updateConnection(db, row.id, changes)
      if (!updated) throw notFound("connection_not_found", "Connection not found")
      return adminView(updated, await usesOf([updated.id]))
    },

    async remove(workspaceId: string, connectionId: string) {
      const row = await find(workspaceId, connectionId)
      await deleteConnection(db, row.id)
      return { ok: true }
    },

    async test(workspaceId: string, connectionId: string) {
      const row = await find(workspaceId, connectionId)
      const plain = openSecret(row)
      try {
        if (isTrackerProvider(row.provider) || row.provider === "telegram") {
          // The account alone: a project's use checks its own target.
          await accounts(row.provider, row.settings, plain).check()
          return { ok: true }
        }
        // A channel with nothing to pick is tested by posting one message to it.
        const ownerName = await findWorkspaceName(db, workspaceId)
        await notifiers(row.provider, row.settings as NotifierConfig, plain).send(testMessage(ownerName ?? "", deps.config.appUrl))
      } catch (error) {
        throw unprocessable("integration_test_failed", error instanceof TrackerError ? error.message : "The connection test failed")
      }
      return { ok: true }
    },

    /** Targets to pick from; the secret stays on the server. */
    async options(workspaceId: string, connectionId: string, query: typeof optionsQuery.static) {
      const row = await find(workspaceId, connectionId)
      const plain = openSecret(row)
      try {
        return await accounts(row.provider, row.settings, plain).list(query.list, { q: query.q, parent: query.parent })
      } catch (error) {
        if (error instanceof ListUnavailableError) throw unprocessable("list_unavailable", error.message)
        throw unprocessable("options_failed", error instanceof TrackerError ? error.message : "The list could not be loaded")
      }
    },
  }
}
