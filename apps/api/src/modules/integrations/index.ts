import {
  type ActiveCollabConfig,
  type GithubConfig,
  type GitlabConfig,
  type IntegrationConfig,
  type IntegrationProvider,
  integrationKind,
  integrationLabel,
  isTrackerProvider,
  type JiraConfig,
  type LinearConfig,
  type NotifierConfig,
  PROVIDER_LABELS,
  type TrackerConfig,
} from "@bugberry/shared"
import { and, asc, eq, sql } from "drizzle-orm"
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
import { notifierFactoryFor } from "../../lib/notifiers/deliver"
import { testMessage } from "../../lib/notifiers/message"
import { createHostGuard, HostGuardError, PRIVATE_HOST_MESSAGE } from "../../lib/net/host-guard"

const labels = t.Array(t.String({ minLength: 1, maxLength: 50 }), { maxItems: 10 })
const githubConfig = t.Object({
  owner: t.String({ pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$" }),
  repo: t.String({ pattern: "^[A-Za-z0-9._-]{1,100}$" }),
  labels,
})
const activeCollabConfig = t.Object({
  baseUrl: t.String({ minLength: 1, maxLength: 300 }),
  projectId: t.Integer({ minimum: 1 }),
  taskListId: t.Integer({ minimum: 1 }),
})
const gitlabConfig = t.Object({
  baseUrl: t.String({ minLength: 1, maxLength: 300 }),
  projectPath: t.String({ pattern: "^[\\w.-]+(?:/[\\w.-]+)+$", maxLength: 255 }),
  labels,
})
const linearConfig = t.Object({ teamKey: t.String({ pattern: "^[A-Za-z][A-Za-z0-9_]{0,9}$" }), labels })
const jiraConfig = t.Object({
  siteUrl: t.String({ minLength: 1, maxLength: 300 }),
  email: t.String({ minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+$" }),
  projectKey: t.String({ pattern: "^[A-Za-z][A-Za-z0-9_]{1,9}$" }),
  issueType: t.String({ minLength: 1, maxLength: 60 }),
  labels,
})
const emptyConfig = t.Object({})
const telegramConfig = t.Object({ chatId: t.String({ pattern: "^(?:-?\\d{1,20}|@[A-Za-z0-9_]{5,32})$" }) })
const webhookConfig = t.Object({ url: t.String({ minLength: 1, maxLength: 500 }) })
const secretField = t.String({ minLength: 1, maxLength: 500 })
const autoSendField = t.Optional(t.Boolean())
const createBody = t.Union([
  t.Object({ provider: t.Literal("github"), config: githubConfig, secret: secretField, autoSend: autoSendField }),
  t.Object({ provider: t.Literal("activecollab"), config: activeCollabConfig, secret: secretField, autoSend: autoSendField }),
  t.Object({ provider: t.Literal("gitlab"), config: gitlabConfig, secret: secretField, autoSend: autoSendField }),
  t.Object({ provider: t.Literal("linear"), config: linearConfig, secret: secretField, autoSend: autoSendField }),
  t.Object({ provider: t.Literal("jira"), config: jiraConfig, secret: secretField, autoSend: autoSendField }),
  t.Object({ provider: t.Literal("slack"), config: emptyConfig, secret: secretField, autoSend: autoSendField }),
  t.Object({ provider: t.Literal("discord"), config: emptyConfig, secret: secretField, autoSend: autoSendField }),
  t.Object({ provider: t.Literal("telegram"), config: telegramConfig, secret: secretField, autoSend: autoSendField }),
  // A webhook's signing secret is optional.
  t.Object({ provider: t.Literal("webhook"), config: webhookConfig, secret: t.Optional(t.String({ maxLength: 500 })), autoSend: autoSendField }),
])
const patchBody = t.Object({
  config: t.Optional(
    t.Union([githubConfig, activeCollabConfig, gitlabConfig, linearConfig, jiraConfig, telegramConfig, webhookConfig, emptyConfig]),
  ),
  secret: t.Optional(t.String({ maxLength: 500 })),
  autoSend: autoSendField,
})

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
/** Where each chat service's incoming webhooks live; any other host is refused. */
const WEBHOOK_HOSTS: Partial<Record<IntegrationProvider, string[]>> = {
  slack: ["hooks.slack.com"],
  discord: ["discord.com", "discordapp.com"],
}

/** An https address (plain http only on this machine), with no login, query or fragment; returned without a trailing slash. */
function normalizeBaseUrl(raw: string, what: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw unprocessable("invalid_base_url", `The ${what} address is not valid`)
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
  if (!secure || url.username || url.password || url.search || url.hash) {
    throw unprocessable("invalid_base_url", `The ${what} address must use https:// and have no query`)
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

const cleanLabels = (list: string[]) => [...new Set(list.map((label) => label.trim()).filter(Boolean))]

/** Checks the config belongs to the provider and returns it cleaned up. */
function normalizeConfig(provider: IntegrationProvider, config: IntegrationConfig): IntegrationConfig {
  if (provider === "github" && "owner" in config) {
    const github: GithubConfig = { owner: config.owner, repo: config.repo, labels: cleanLabels(config.labels) }
    return github
  }
  if (provider === "activecollab" && "projectId" in config) {
    const activecollab: ActiveCollabConfig = {
      baseUrl: normalizeBaseUrl(config.baseUrl, "ActiveCollab"),
      projectId: config.projectId,
      taskListId: config.taskListId,
    }
    return activecollab
  }
  if (provider === "gitlab" && "projectPath" in config) {
    const gitlab: GitlabConfig = {
      baseUrl: normalizeBaseUrl(config.baseUrl, "GitLab"),
      projectPath: config.projectPath.replace(/^\/+|\/+$/g, ""),
      labels: cleanLabels(config.labels),
    }
    return gitlab
  }
  if (provider === "linear" && "teamKey" in config) {
    const linear: LinearConfig = { teamKey: config.teamKey.toUpperCase(), labels: cleanLabels(config.labels) }
    return linear
  }
  if (provider === "jira" && "projectKey" in config) {
    const siteUrl = normalizeBaseUrl(config.siteUrl, "Jira")
    // Jira Cloud only: https://<name>.atlassian.net, nothing after it.
    if (!/^https:\/\/[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(siteUrl)) {
      throw unprocessable("invalid_config", "Use your Jira Cloud address, such as https://yourteam.atlassian.net")
    }
    const jira: JiraConfig = {
      siteUrl: siteUrl.toLowerCase(),
      email: config.email.trim(),
      projectKey: config.projectKey.toUpperCase(),
      issueType: config.issueType.trim(),
      labels: cleanLabels(config.labels),
    }
    return jira
  }
  if ((provider === "slack" || provider === "discord") && Object.keys(config).length === 0) return {}
  if (provider === "telegram" && "chatId" in config) return { chatId: config.chatId.trim() }
  if (provider === "webhook" && "url" in config) {
    let url: URL
    try {
      url = new URL(config.url.trim())
    } catch {
      throw unprocessable("invalid_webhook_url", "The webhook address is not valid")
    }
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
    if (!secure || url.username || url.password || url.hash) {
      throw unprocessable("invalid_webhook_url", "The webhook address must use https://")
    }
    return { url: url.href }
  }
  throw unprocessable("invalid_config", "The settings don't match the integration provider")
}

/** A Slack or Discord webhook URL (the secret itself) must point at that service. */
function checkWebhookSecret(provider: IntegrationProvider, secret: string): void {
  const hosts = WEBHOOK_HOSTS[provider]
  if (!hosts) return
  let url: URL
  try {
    url = new URL(secret)
  } catch {
    throw unprocessable("invalid_webhook_url", `Paste the ${PROVIDER_LABELS[provider]} webhook URL`)
  }
  const pathOk = provider === "discord" ? url.pathname.startsWith("/api/webhooks/") : url.pathname.startsWith("/services/")
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || !pathOk) {
    throw unprocessable("invalid_webhook_url", `That is not a ${PROVIDER_LABELS[provider]} webhook URL`)
  }
}

/** Every address an integration calls, for the private-network check at save time. */
function addressesOf(config: IntegrationConfig): string[] {
  if ("baseUrl" in config) return [config.baseUrl]
  if ("siteUrl" in config) return [config.siteUrl]
  if ("url" in config) return [config.url]
  return []
}

type IntegrationRow = typeof integration.$inferSelect

function publicIntegration(row: IntegrationRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    kind: integrationKind(row.provider),
    config: row.config,
    autoSend: row.autoSend,
    /** A notification channel's last delivery: when it worked, or why it failed. */
    lastError: row.lastError,
    lastDeliveredAt: row.lastDeliveredAt,
    label: integrationLabel(row.provider, row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function integrationsModule(deps: AppDeps) {
  const { db } = deps
  const box = createSecretBox(deps.config.encryptionKey)
  const trackers = trackerFactoryFor(deps)
  const notifiers = notifierFactoryFor(deps)
  const guard = createHostGuard({ allowPrivate: deps.config.allowPrivateIntegrationHosts })
  /** Refuses settings whose addresses point into a private network (unless the server allows it). */
  const checkAddresses = async (config: IntegrationConfig) => {
    for (const address of addressesOf(config)) {
      try {
        await guard(address)
      } catch (error) {
        throw unprocessable("private_address", error instanceof HostGuardError ? error.message : PRIVATE_HOST_MESSAGE)
      }
    }
  }

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
        const config = normalizeConfig(body.provider, body.config)
        const secret = body.secret?.trim() ?? ""
        checkWebhookSecret(body.provider, secret)
        await checkAddresses(config)
        const [created] = await db
          .insert(integration)
          .values({
            id: newId(),
            projectId: params.id,
            provider: body.provider,
            config,
            secretEncrypted: box.seal(secret),
            // Only trackers send every report as an issue; notifiers always post new reports.
            autoSend: isTrackerProvider(body.provider) ? (body.autoSend ?? false) : false,
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
          changes.config = normalizeConfig(row.provider, body.config)
          await checkAddresses(changes.config)
        }
        if (body.secret?.trim()) {
          checkWebhookSecret(row.provider, body.secret.trim())
          changes.secretEncrypted = box.seal(body.secret.trim())
        }
        if (body.autoSend !== undefined && isTrackerProvider(row.provider)) changes.autoSend = body.autoSend
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
          if (isTrackerProvider(row.provider)) {
            await trackers(row.provider, row.config as TrackerConfig, secret).test()
          } else {
            // A notifier is tested by posting one message: no retries, so the admin sees the answer at once.
            const [owner] = await db.select({ name: project.name }).from(project).where(eq(project.id, params.id)).limit(1)
            await notifiers(row.provider, row.config as NotifierConfig, secret).send(testMessage(owner?.name ?? "", deps.config.appUrl))
            // It got through, so the channel works again: an old failure would mislead.
            await db.update(integration).set({ lastError: null, lastDeliveredAt: sql`now()` }).where(eq(integration.id, row.id))
          }
        } catch (error) {
          throw unprocessable("integration_test_failed", error instanceof TrackerError ? error.message : "The connection test failed")
        }
        return { ok: true }
      },
      { auth: true },
    )
}
