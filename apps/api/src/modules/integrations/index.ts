import {
  INTEGRATION_PROVIDERS,
  integrationKind,
  isTrackerProvider,
  type NotifierConfig,
  type TrackerConfig,
  targetKey,
  type UseTarget,
} from "@bugberry/shared"
import { and, eq, sql } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { connection, integration, project } from "../../db/schema"
import { conflict, notFound, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { loadUse, type ResolvedUse, usesOfProject } from "./resolve"
import { normalizeTarget, targetBody } from "../connections/validate"
import { notifierFactoryFor } from "../notifiers/deliver"
import { testMessage } from "../notifiers/message"
import { createSecretBox, SECRET_UNREADABLE, SecretError } from "../../lib/secret-box"
import { trackerFactoryFor } from "../trackers/default"
import { TrackerError } from "../trackers/providers"
import { requireProjectRole } from "../workspaces/access"

const createBody = t.Object({
  connectionId: t.String({ minLength: 1 }),
  target: targetBody,
  autoSend: t.Optional(t.Boolean()),
})
/** A use's target never changes: changing it is removing the use and adding it again. */
const patchBody = t.Object({
  labels: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 50 }), { maxItems: 10 })),
  autoSend: t.Optional(t.Boolean()),
  // Elysia drops unknown keys silently; a target sent here is refused instead (422).
  target: t.Optional(t.Never()),
})

/** What a project sees of a use: never the connection's settings or secret. */
function publicUse(use: ResolvedUse) {
  return {
    id: use.id,
    projectId: use.projectId,
    provider: use.provider,
    kind: integrationKind(use.provider),
    connection: { id: use.connectionId, name: use.connectionName },
    target: use.target,
    label: use.label,
    autoSend: use.autoSend,
    /** A notification channel's last delivery: when it worked, or why it failed. */
    lastError: use.lastError,
    lastDeliveredAt: use.lastDeliveredAt,
    createdAt: use.createdAt,
  }
}

/** Postgres refused a duplicate (project, connection, target): the unique index does the deciding under races. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current; current = (current as { cause?: unknown }).cause) {
    const code = (current as { errno?: unknown; code?: unknown }).errno ?? (current as { code?: unknown }).code
    if (code === "23505") return true
  }
  return false
}

export function integrationsModule(deps: AppDeps) {
  const { db } = deps
  const box = createSecretBox(deps.config.encryptionKey)
  const trackers = trackerFactoryFor(deps)
  const notifiers = notifierFactoryFor(deps)

  const find = async (projectId: string, id: string) => {
    const use = await loadUse(db, id)
    if (!use || use.projectId !== projectId) throw notFound("integration_not_found", "Integration not found")
    return use
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/projects/:id/integrations",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id)
        return (await usesOfProject(db, params.id, INTEGRATION_PROVIDERS)).map(publicUse)
      },
      { auth: true },
    )
    .post(
      "/projects/:id/integrations",
      async ({ user, params, body }) => {
        const workspaceId = await requireProjectRole(db, user.id, params.id)
        const [owner] = await db
          .select({ id: connection.id, provider: connection.provider })
          .from(connection)
          .where(and(eq(connection.id, body.connectionId), eq(connection.workspaceId, workspaceId)))
          .limit(1)
        if (!owner) throw notFound("connection_not_found", "Connection not found")
        const target = normalizeTarget(owner.provider, body.target)
        const id = newId()
        try {
          await db.insert(integration).values({
            id,
            projectId: params.id,
            connectionId: owner.id,
            provider: owner.provider,
            config: target,
            targetKey: targetKey(owner.provider, target),
            // Only trackers send every report as an issue; notifiers always post new reports.
            autoSend: isTrackerProvider(owner.provider) ? (body.autoSend ?? false) : false,
          })
        } catch (error) {
          if (isUniqueViolation(error)) throw conflict("already_used", "This project already uses that connection for that target")
          throw error
        }
        return publicUse(await find(params.id, id))
      },
      { auth: true, body: createBody },
    )
    .patch(
      "/projects/:id/integrations/:integrationId",
      async ({ user, params, body }) => {
        await requireProjectRole(db, user.id, params.id)
        const use = await find(params.id, params.integrationId)
        const changes: Partial<typeof integration.$inferInsert> = {}
        if (body.labels && "labels" in use.target) {
          changes.config = { ...use.target, labels: [...new Set(body.labels.map((label) => label.trim()).filter(Boolean))] } as UseTarget
        }
        if (body.autoSend !== undefined && isTrackerProvider(use.provider)) changes.autoSend = body.autoSend
        if (Object.keys(changes).length > 0) await db.update(integration).set(changes).where(eq(integration.id, use.id))
        return publicUse(await find(params.id, use.id))
      },
      { auth: true, body: patchBody },
    )
    .delete(
      "/projects/:id/integrations/:integrationId",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id)
        const use = await find(params.id, params.integrationId)
        // Links to issues already sent stay (report_external_link.integration_id is set null).
        await db.delete(integration).where(eq(integration.id, use.id))
        return { ok: true }
      },
      { auth: true },
    )
    .post(
      "/projects/:id/integrations/:integrationId/test",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id)
        const use = await find(params.id, params.integrationId)
        let secret: string
        try {
          secret = box.open(use.secretEncrypted)
        } catch (error) {
          if (error instanceof SecretError) throw conflict("secret_unreadable", SECRET_UNREADABLE)
          throw error
        }
        try {
          if (isTrackerProvider(use.provider)) {
            await trackers(use.provider, use.config as TrackerConfig, secret).test()
          } else {
            // A notifier is tested by posting one message: no retries, so the answer comes at once.
            const [owner] = await db.select({ name: project.name }).from(project).where(eq(project.id, params.id)).limit(1)
            await notifiers(use.provider, use.config as NotifierConfig, secret).send(testMessage(owner?.name ?? "", deps.config.appUrl))
            // It got through, so the channel works again: an old failure would mislead.
            await db.update(integration).set({ lastError: null, lastDeliveredAt: sql`now()` }).where(eq(integration.id, use.id))
          }
        } catch (error) {
          throw unprocessable("integration_test_failed", error instanceof TrackerError ? error.message : "The connection test failed")
        }
        return { ok: true }
      },
      { auth: true },
    )
}
