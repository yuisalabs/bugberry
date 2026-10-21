import { type ConnectionSettings, integrationKind, isTrackerProvider, type NotifierConfig } from "@bugberry/shared"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { connection, integration, project, workspace } from "../../db/schema"
import { conflict, notFound, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { checkAddresses, checkWebhookSecret, normalizeSettings, settingsSchemas } from "../../lib/integrations/validate"
import { createHostGuard } from "../../lib/net/host-guard"
import { notifierFactoryFor } from "../../lib/notifiers/deliver"
import { testMessage } from "../../lib/notifiers/message"
import { createSecretBox, SECRET_UNREADABLE, SecretError } from "../../lib/secret-box"
import { TrackerError } from "../../lib/trackers/providers"
import { requireMember } from "../../workspaces/access"

const name = t.String({ minLength: 1, maxLength: 80 })
const secret = t.String({ minLength: 1, maxLength: 500 })
const createBody = t.Union([
  t.Object({ provider: t.Union([t.Literal("github"), t.Literal("linear")]), name, settings: settingsSchemas.none, secret }),
  t.Object({ provider: t.Union([t.Literal("gitlab"), t.Literal("activecollab")]), name, settings: settingsSchemas.address, secret }),
  t.Object({ provider: t.Literal("jira"), name, settings: settingsSchemas.jira, secret }),
  t.Object({ provider: t.Union([t.Literal("slack"), t.Literal("discord"), t.Literal("telegram")]), name, settings: settingsSchemas.none, secret }),
  // A webhook's signing secret is optional.
  t.Object({ provider: t.Literal("webhook"), name, settings: settingsSchemas.webhook, secret: t.Optional(t.String({ maxLength: 500 })) }),
])
const patchBody = t.Object({
  name: t.Optional(name),
  settings: t.Optional(t.Union([settingsSchemas.address, settingsSchemas.jira, settingsSchemas.webhook, settingsSchemas.none])),
  /** Empty keeps the current secret. */
  secret: t.Optional(t.String({ maxLength: 500 })),
})

type ConnectionRow = typeof connection.$inferSelect
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
  const guard = createHostGuard({ allowPrivate: deps.config.allowPrivateIntegrationHosts })

  const usesOf = async (ids: string[]): Promise<UseRow[]> =>
    ids.length === 0
      ? []
      : db
          .select({
            connectionId: integration.connectionId,
            projectId: integration.projectId,
            projectName: project.name,
            lastError: integration.lastError,
            lastDeliveredAt: integration.lastDeliveredAt,
            updatedAt: integration.updatedAt,
          })
          .from(integration)
          .innerJoin(project, eq(project.id, integration.projectId))
          .where(inArray(integration.connectionId, ids))

  const find = async (workspaceId: string, id: string) => {
    const [row] = await db
      .select()
      .from(connection)
      .where(and(eq(connection.id, id), eq(connection.workspaceId, workspaceId)))
      .limit(1)
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
        const rows = await db.select().from(connection).where(eq(connection.workspaceId, params.id)).orderBy(asc(connection.createdAt))
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
        const [created] = await db
          .insert(connection)
          .values({
            id: newId(),
            workspaceId: params.id,
            provider: body.provider,
            name: body.name.trim(),
            settings,
            secretEncrypted: box.seal(plain),
          })
          .returning()
        if (!created) throw new Error("Failed to create connection")
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
        const [updated] =
          Object.keys(changes).length === 0
            ? [row]
            : await db.update(connection).set(changes).where(eq(connection.id, row.id)).returning()
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
        // Its uses go with it; links to issues already sent stay (report_external_link.integration_id is set null).
        await db.delete(connection).where(eq(connection.id, row.id))
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
            throw new TrackerError("Not available yet")
          }
          // A channel with nothing to pick is tested by posting one message to it.
          const [owner] = await db.select({ name: workspace.name }).from(workspace).where(eq(workspace.id, params.id)).limit(1)
          await notifiers(row.provider, row.settings as NotifierConfig, plain).send(testMessage(owner?.name ?? "", deps.config.appUrl))
        } catch (error) {
          throw unprocessable("integration_test_failed", error instanceof TrackerError ? error.message : "The connection test failed")
        }
        return { ok: true }
      },
      { auth: true },
    )
}
