import type { ConnectionSettings, IntegrationProvider, UseTarget } from "@bugberry/shared"
import { PROVIDER_LABELS } from "@bugberry/shared"
import { t } from "elysia"
import { unprocessable } from "../errors"
import { type HostGuard, HostGuardError, PRIVATE_HOST_MESSAGE } from "../net/host-guard"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
/** Where each chat service's incoming webhooks live; any other host is refused. */
const WEBHOOK_HOSTS: Partial<Record<IntegrationProvider, { hosts: string[]; path: string }>> = {
  slack: { hosts: ["hooks.slack.com"], path: "/services/" },
  discord: { hosts: ["discord.com", "discordapp.com"], path: "/api/webhooks/" },
}

const baseUrlField = t.String({ minLength: 1, maxLength: 300 })
export const settingsSchemas = {
  none: t.Object({}),
  address: t.Object({ baseUrl: baseUrlField }),
  jira: t.Object({ siteUrl: baseUrlField, email: t.String({ minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+$" }) }),
  webhook: t.Object({ url: t.String({ minLength: 1, maxLength: 500 }) }),
}

const labels = t.Array(t.String({ minLength: 1, maxLength: 50 }), { maxItems: 10 })
export const targetSchemas = {
  github: t.Object({ owner: t.String({ pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$" }), repo: t.String({ pattern: "^[A-Za-z0-9._-]{1,100}$" }), labels }),
  gitlab: t.Object({ projectPath: t.String({ pattern: "^[\\w.-]+(?:/[\\w.-]+)+$", maxLength: 255 }), labels }),
  linear: t.Object({ teamKey: t.String({ pattern: "^[A-Za-z][A-Za-z0-9_]{0,9}$" }), labels }),
  jira: t.Object({
    projectKey: t.String({ pattern: "^[A-Za-z][A-Za-z0-9_]{1,9}$" }),
    issueType: t.String({ minLength: 1, maxLength: 60 }),
    labels,
  }),
  activecollab: t.Object({ projectId: t.Integer({ minimum: 1 }), taskListId: t.Integer({ minimum: 1 }) }),
  telegram: t.Object({ chatId: t.String({ pattern: "^(?:-?\\d{1,20}|@[A-Za-z0-9_]{5,32})$" }) }),
  none: t.Object({}),
}

/** An https address (plain http only on this machine), with no login, query or fragment; returned without a trailing slash. */
export function normalizeBaseUrl(raw: string, what: string): string {
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

const mismatch = () => unprocessable("invalid_config", "The settings don't match the integration provider")

/** Checks a connection's settings belong to its provider and returns them cleaned up. */
export function normalizeSettings(provider: IntegrationProvider, settings: Record<string, unknown>): ConnectionSettings {
  const text = (key: string) => (typeof settings[key] === "string" ? (settings[key] as string) : null)
  if (provider === "gitlab" || provider === "activecollab") {
    const baseUrl = text("baseUrl")
    if (baseUrl === null) throw mismatch()
    return { baseUrl: normalizeBaseUrl(baseUrl, PROVIDER_LABELS[provider]) }
  }
  if (provider === "jira") {
    const siteUrl = text("siteUrl")
    const email = text("email")
    if (siteUrl === null || email === null) throw mismatch()
    const site = normalizeBaseUrl(siteUrl, "Jira")
    // Jira Cloud only: https://<name>.atlassian.net, nothing after it.
    if (!/^https:\/\/[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(site)) {
      throw unprocessable("invalid_config", "Use your Jira Cloud address, such as https://yourteam.atlassian.net")
    }
    return { siteUrl: site.toLowerCase(), email: email.trim() }
  }
  if (provider === "webhook") {
    const raw = text("url")
    if (raw === null) throw mismatch()
    let url: URL
    try {
      url = new URL(raw.trim())
    } catch {
      throw unprocessable("invalid_webhook_url", "The webhook address is not valid")
    }
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
    if (!secure || url.username || url.password || url.hash) {
      throw unprocessable("invalid_webhook_url", "The webhook address must use https://")
    }
    return { url: url.href }
  }
  if (Object.keys(settings).length > 0) throw mismatch()
  return {}
}

const cleanLabels = (list: string[]) => [...new Set(list.map((label) => label.trim()).filter(Boolean))]

/** Checks a use's target belongs to its provider and returns it cleaned up. */
export function normalizeTarget(provider: IntegrationProvider, target: Record<string, unknown>): UseTarget {
  const has = (...keys: string[]) => keys.every((key) => key in target)
  const list = () => cleanLabels((target.labels as string[] | undefined) ?? [])
  if (provider === "github" && has("owner", "repo")) return { owner: String(target.owner), repo: String(target.repo), labels: list() }
  if (provider === "gitlab" && has("projectPath")) {
    return { projectPath: String(target.projectPath).replace(/^\/+|\/+$/g, ""), labels: list() }
  }
  if (provider === "linear" && has("teamKey")) return { teamKey: String(target.teamKey).toUpperCase(), labels: list() }
  if (provider === "jira" && has("projectKey", "issueType")) {
    return { projectKey: String(target.projectKey).toUpperCase(), issueType: String(target.issueType).trim(), labels: list() }
  }
  if (provider === "activecollab" && has("projectId", "taskListId")) {
    return { projectId: Number(target.projectId), taskListId: Number(target.taskListId) }
  }
  if (provider === "telegram" && has("chatId")) return { chatId: String(target.chatId).trim() }
  if ((provider === "slack" || provider === "discord" || provider === "webhook") && Object.keys(target).length === 0) return {}
  throw unprocessable("invalid_target", "The target doesn't match the connection's provider")
}

/** A Slack or Discord webhook URL (the secret itself) must point at that service. */
export function checkWebhookSecret(provider: IntegrationProvider, secret: string): void {
  const rule = WEBHOOK_HOSTS[provider]
  if (!rule) return
  let url: URL
  try {
    url = new URL(secret)
  } catch {
    throw unprocessable("invalid_webhook_url", `Paste the ${PROVIDER_LABELS[provider]} webhook URL`)
  }
  if (url.protocol !== "https:" || !rule.hosts.includes(url.hostname) || !url.pathname.startsWith(rule.path)) {
    throw unprocessable("invalid_webhook_url", `That is not a ${PROVIDER_LABELS[provider]} webhook URL`)
  }
}

/** Refuses settings whose addresses point into a private network (unless the server allows it). */
export async function checkAddresses(guard: HostGuard, settings: ConnectionSettings): Promise<void> {
  const addresses = "baseUrl" in settings ? [settings.baseUrl] : "siteUrl" in settings ? [settings.siteUrl] : "url" in settings ? [settings.url] : []
  for (const address of addresses) {
    try {
      await guard(address)
    } catch (error) {
      throw unprocessable("private_address", error instanceof HostGuardError ? error.message : PRIVATE_HOST_MESSAGE)
    }
  }
}
