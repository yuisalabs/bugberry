import { type ConnectionSettings, integrationKind, isTrackerProvider, type NotifierConfig } from "@bugberry/shared"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import type { connection } from "../../db/schema"
import { conflict, notFound, unprocessable } from "../../lib/errors"
import { accountFactoryFor, ListUnavailableError, OPTION_LISTS } from "./accounts"
import { checkAddresses, checkWebhookSecret, normalizeSettings, settingsBody, settingsSchemas } from "./validate"
import { createHostGuard } from "../../lib/net/host-guard"
import { notifierFactoryFor } from "../notifiers/deliver"
import { testMessage } from "../notifiers/message"
import { createSecretBox, SECRET_UNREADABLE, SecretError } from "../../lib/secret-box"
import { TrackerError } from "../trackers/providers"
import { requireMember } from "../workspaces/access"
import { findWorkspaceName } from "../workspaces/repository"
import {
  type ConnectionRow,
  deleteConnection,
  findConnection,
  insertConnection,
  listConnections,
  listConnectionUses,
  updateConnection,
} from "./repository"

const name = t.String({ minLength: 1, maxLength: 80 })
const secret = t.String({ minLength: 1, maxLength: 500 })
const createBody = t.Union([
  t.Object({ provider: t.Union([t.Literal("github"), t.Literal("linear")]), name, settings: settingsSchemas.none, secret }),
  t.Object({ provider: t.Union([t.Literal("gitlab"), t.Literal("activecollab")]), name, settings: settingsSchemas.address, secret }),
  t.Object({ provider: t.Literal("jira"), name, settings: settingsSchemas.jira, secret }),
  // Checked field by field in normalizeSettings, so a wrong workspace slug gets its own message.
  t.Object({ provider: t.Literal("plane"), name, settings: settingsBody, secret }),
  t.Object({ provider: t.Union([t.Literal("slack"), t.Literal("discord"), t.Literal("telegram")]), name, settings: settingsSchemas.none, secret }),
  // A webhook's signing secret is optional.
  t.Object({ provider: t.Literal("webhook"), name, settings: settingsSchemas.webhook, secret: t.Optional(t.String({ maxLength: 500 })) }),
])
const patchBody = t.Object({
  name: t.Optional(name),
  settings: t.Optional(settingsBody),
  /** Empty keeps the current secret. */
  secret: t.Optional(t.String({ maxLength: 500 })),
})

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

export function connectionsModule(deps: AppDeps) {
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

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/workspaces/:id/connections",
      async ({ user, params }) => {
        const role = await requireMember(db, user.id, params.id)
        const rows = await listConnections(db, params.id)
        const uses = await usesOf(rows.map((row) => row.id))
        const view = role === "admin" ? adminView : memberView
        return rows.map((row) => view(row, uses.filter((use) => use.connectionId === row.id)))
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/connections",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id, "admin")
        const settings = normalizeSettings(body.provider, body.settings)
        const plain = body.secret?.trim() ?? ""
        checkWebhookSecret(body.provider, plain)
        await checkAddresses(guard, settings)
        const created = await insertConnection(db, {
          workspaceId: params.id,
          provider: body.provider,
          name: body.name.trim(),
          settings,
          secretEncrypted: box.seal(plain),
        })
        return adminView(created, [])
      },
      { auth: true, body: createBody },
    )
    .patch(
      "/workspaces/:id/connections/:connectionId",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id, "admin")
        const row = await find(params.id, params.connectionId)
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
      { auth: true, body: patchBody },
    )
    .delete(
      "/workspaces/:id/connections/:connectionId",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id, "admin")
        const row = await find(params.id, params.connectionId)
        await deleteConnection(db, row.id)
        return { ok: true }
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/connections/:connectionId/test",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id, "admin")
        const row = await find(params.id, params.connectionId)
        const plain = openSecret(row)
        try {
          if (isTrackerProvider(row.provider) || row.provider === "telegram") {
            // The account alone: a project's use checks its own target.
            await accounts(row.provider, row.settings, plain).check()
            return { ok: true }
          }
          // A channel with nothing to pick is tested by posting one message to it.
          const ownerName = await findWorkspaceName(db, params.id)
          await notifiers(row.provider, row.settings as NotifierConfig, plain).send(testMessage(ownerName ?? "", deps.config.appUrl))
        } catch (error) {
          throw unprocessable("integration_test_failed", error instanceof TrackerError ? error.message : "The connection test failed")
        }
        return { ok: true }
      },
      { auth: true },
    )
    .get(
      "/workspaces/:id/connections/:connectionId/options",
      async ({ user, params, query }) => {
        // Anyone in the workspace picks targets from these lists; the secret stays on the server.
        await requireMember(db, user.id, params.id)
        const row = await find(params.id, params.connectionId)
        const plain = openSecret(row)
        try {
          return await accounts(row.provider, row.settings, plain).list(query.list, { q: query.q, parent: query.parent })
        } catch (error) {
          if (error instanceof ListUnavailableError) throw unprocessable("list_unavailable", error.message)
          throw unprocessable("options_failed", error instanceof TrackerError ? error.message : "The list could not be loaded")
        }
      },
      {
        auth: true,
        query: t.Object({
          list: t.Union(OPTION_LISTS.map((list) => t.Literal(list))),
          q: t.Optional(t.String({ maxLength: 100 })),
          parent: t.Optional(t.String({ minLength: 1, maxLength: 300 })),
        }),
      },
    )
}
