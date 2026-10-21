import {
  type ActiveCollabConfig,
  type GithubConfig,
  integrationLabel,
  isTrackerProvider,
  type TrackerConfig,
  type TrackerProvider,
} from "@bugberry/shared"
import { and, asc, eq } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { integration, project } from "../../db/schema"
import { conflict, notFound, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { createSecretBox, SECRET_UNREADABLE, SecretError } from "../../lib/secret-box"
import { requireProjectRole } from "../../workspaces/access"
import { TrackerError } from "../../lib/trackers/providers"
import { trackerFactoryFor } from "../../lib/trackers/default"

const githubConfig = t.Object({
  owner: t.String({ pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$" }),
  repo: t.String({ pattern: "^[A-Za-z0-9._-]{1,100}$" }),
  labels: t.Array(t.String({ minLength: 1, maxLength: 50 }), { maxItems: 10 }),
})
const activeCollabConfig = t.Object({
  baseUrl: t.String({ minLength: 1, maxLength: 300 }),
  projectId: t.Integer({ minimum: 1 }),
  taskListId: t.Integer({ minimum: 1 }),
})
const secretField = t.String({ minLength: 1, maxLength: 500 })
const createBody = t.Union([
  t.Object({ provider: t.Literal("github"), config: githubConfig, secret: secretField, autoSend: t.Optional(t.Boolean()) }),
  t.Object({
    provider: t.Literal("activecollab"),
    config: activeCollabConfig,
    secret: secretField,
    autoSend: t.Optional(t.Boolean()),
  }),
])
const patchBody = t.Object({
  config: t.Optional(t.Union([githubConfig, activeCollabConfig])),
  secret: t.Optional(secretField),
  autoSend: t.Optional(t.Boolean()),
})

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw unprocessable("invalid_base_url", "The ActiveCollab address is not valid")
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
  if (!secure || url.username || url.password || url.search || url.hash) {
    throw unprocessable("invalid_base_url", "The ActiveCollab address must use https:// and have no query")
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

/** Checks the config belongs to the provider and returns it cleaned up. */
function normalizeConfig(provider: TrackerProvider, config: TrackerConfig): TrackerConfig {
  if (provider === "github" && "owner" in config) {
    const github: GithubConfig = {
      owner: config.owner,
      repo: config.repo,
      labels: [...new Set(config.labels.map((label) => label.trim()).filter(Boolean))],
    }
    return github
  }
  if (provider === "activecollab" && "projectId" in config) {
    const activecollab: ActiveCollabConfig = {
      baseUrl: normalizeBaseUrl(config.baseUrl),
      projectId: config.projectId,
      taskListId: config.taskListId,
    }
    return activecollab
  }
  throw unprocessable("invalid_config", "The settings don't match the integration provider")
}

type IntegrationRow = typeof integration.$inferSelect

function publicIntegration(row: IntegrationRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    config: row.config,
    autoSend: row.autoSend,
    label: integrationLabel(row.provider, row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function integrationsModule(deps: AppDeps) {
  const { db } = deps
  const box = createSecretBox(deps.config.encryptionKey)
  const trackers = trackerFactoryFor(deps)

  const find = async (projectId: string, id: string) => {
    const [row] = await db
      .select()
      .from(integration)
      .where(and(eq(integration.id, id), eq(integration.projectId, projectId)))
      .limit(1)
    if (!row) throw notFound("integration_not_found", "Integration not found")
    return row
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/projects/:id/integrations",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        const rows = await db
          .select()
          .from(integration)
          .where(eq(integration.projectId, params.id))
          .orderBy(asc(integration.createdAt))
        return rows.map(publicIntegration)
      },
      { auth: true },
    )
    .post(
      "/projects/:id/integrations",
      async ({ user, params, body }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        const [created] = await db
          .insert(integration)
          .values({
            id: newId(),
            projectId: params.id,
            provider: body.provider,
            config: normalizeConfig(body.provider, body.config),
            secretEncrypted: box.seal(body.secret.trim()),
            autoSend: body.autoSend ?? false,
          })
          .returning()
        if (!created) throw new Error("Failed to create integration")
        return publicIntegration(created)
      },
      { auth: true, body: createBody },
    )
    .patch(
      "/projects/:id/integrations/:integrationId",
      async ({ user, params, body }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        const row = await find(params.id, params.integrationId)
        const changes: Partial<typeof integration.$inferInsert> = {}
        if (body.config) {
          if (!isTrackerProvider(row.provider)) throw unprocessable("invalid_config", "The settings don't match the integration provider")
          changes.config = normalizeConfig(row.provider, body.config)
        }
        if (body.secret?.trim()) changes.secretEncrypted = box.seal(body.secret.trim())
        if (body.autoSend !== undefined) changes.autoSend = body.autoSend
        if (Object.keys(changes).length === 0) return publicIntegration(row)
        const [updated] = await db.update(integration).set(changes).where(eq(integration.id, row.id)).returning()
        if (!updated) throw notFound("integration_not_found", "Integration not found")
        return publicIntegration(updated)
      },
      { auth: true, body: patchBody },
    )
    .delete(
      "/projects/:id/integrations/:integrationId",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        const row = await find(params.id, params.integrationId)
        await db.delete(integration).where(eq(integration.id, row.id))
        return { ok: true }
      },
      { auth: true },
    )
    .post(
      "/projects/:id/integrations/:integrationId/test",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        const row = await find(params.id, params.integrationId)
        let secret: string
        try {
          secret = box.open(row.secretEncrypted)
        } catch (error) {
          if (error instanceof SecretError) throw conflict("secret_unreadable", SECRET_UNREADABLE)
          throw error
        }
        try {
          if (!isTrackerProvider(row.provider)) throw new TrackerError("This integration cannot be tested yet")
          await trackers(row.provider, row.config as TrackerConfig, secret).test()
        } catch (error) {
          throw unprocessable("integration_test_failed", error instanceof TrackerError ? error.message : "The connection test failed")
        }
        return { ok: true }
      },
      { auth: true },
    )
}
