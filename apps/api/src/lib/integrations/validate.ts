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

/** An https address (plain http only on this machine), with no login, query or fragment; returned without a trailing slash. */
export function normalizeBaseUrl(raw: string, what: string): string {
  let url: URL
  try {
    if (raw.length > 300) throw new Error("too long")
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

/** An edit's settings arrive loose and are checked field by field, for the same reason as a target's. */
export const settingsBody = t.Record(t.String(), t.Unknown())

/** Checks a connection's settings belong to its provider and returns them cleaned up. */
export function normalizeSettings(provider: IntegrationProvider, settings: Record<string, unknown>): ConnectionSettings {
  const text = (key: string) => (typeof settings[key] === "string" ? (settings[key] as string) : null)
  if (provider === "plane") {
    const baseUrl = text("baseUrl")
    const workspaceSlug = text("workspaceSlug")?.trim() ?? ""
    if (baseUrl === null) throw mismatch()
    // The workspace part of Plane's URLs: letters, digits, dashes and underscores.
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(workspaceSlug)) {
      throw unprocessable("invalid_config", "Enter the workspace slug from your Plane address")
    }
    return { baseUrl: normalizeBaseUrl(baseUrl, "Plane"), workspaceSlug }
  }
  if (provider === "gitlab" || provider === "activecollab") {
    const baseUrl = text("baseUrl")
    if (baseUrl === null) throw mismatch()
    return { baseUrl: normalizeBaseUrl(baseUrl, PROVIDER_LABELS[provider]) }
  }
  if (provider === "jira") {
    const siteUrl = text("siteUrl")
    const email = text("email")
    if (siteUrl === null || email === null) throw mismatch()
    if (!/^[^\s@]+@[^\s@]+$/.test(email.trim()) || email.length > 254) {
      throw unprocessable("invalid_config", "Enter the email of the Atlassian account")
    }
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
      if (raw.length > 500) throw new Error("too long")
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

const LABELS_LIMIT = "Use at most 10 labels of up to 50 characters each"
const PATTERNS = {
  owner: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
  repo: /^[A-Za-z0-9._-]{1,100}$/,
  projectPath: /^[\w.-]+(?:\/[\w.-]+)+$/,
  teamKey: /^[A-Za-z][A-Za-z0-9_]{0,9}$/,
  projectKey: /^[A-Za-z][A-Za-z0-9_]{1,9}$/,
  chatId: /^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/,
  planeProject: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}

/**
 * A target arrives as a loose object and is checked here, field by field: a schema union would quietly turn a target
 * that breaks one rule into {} and answer with a message about the wrong thing.
 */
export const targetBody = t.Record(t.String(), t.Unknown())

/** Checks a use's target belongs to its provider and returns it cleaned up. */
export function normalizeTarget(provider: IntegrationProvider, target: Record<string, unknown>): UseTarget {
  const invalid = (message: string) => unprocessable("invalid_target", message)
  const text = (key: string, pattern: RegExp, message: string) => {
    const value = typeof target[key] === "string" ? (target[key] as string).trim() : ""
    if (!pattern.test(value)) throw invalid(message)
    return value
  }
  const labels = () => {
    const raw = target.labels ?? []
    if (!Array.isArray(raw) || raw.some((label) => typeof label !== "string")) throw invalid(LABELS_LIMIT)
    const clean = [...new Set((raw as string[]).map((label) => label.trim()).filter(Boolean))]
    if (clean.length > 10 || clean.some((label) => label.length > 50)) throw invalid(LABELS_LIMIT)
    return clean
  }
  const positive = (key: string) => {
    const value = Number(target[key])
    if (!Number.isInteger(value) || value < 1) throw invalid("Pick a project and a task list")
    return value
  }
  switch (provider) {
    case "github":
      return {
        owner: text("owner", PATTERNS.owner, "That repository is not valid"),
        repo: text("repo", PATTERNS.repo, "That repository is not valid"),
        labels: labels(),
      }
    case "gitlab": {
      const projectPath = typeof target.projectPath === "string" ? target.projectPath.trim().replace(/^\/+|\/+$/g, "") : ""
      if (!PATTERNS.projectPath.test(projectPath) || projectPath.length > 255) throw invalid("That GitLab project is not valid")
      return { projectPath, labels: labels() }
    }
    case "linear":
      return { teamKey: text("teamKey", PATTERNS.teamKey, "Enter the team key, such as ENG").toUpperCase(), labels: labels() }
    case "jira": {
      const projectKey = text("projectKey", PATTERNS.projectKey, "Enter the project key, such as BUG").toUpperCase()
      const issueType = text("issueType", /^.{1,60}$/, "Enter an issue type, such as Bug")
      return { projectKey, issueType, labels: labels() }
    }
    case "activecollab":
      return { projectId: positive("projectId"), taskListId: positive("taskListId") }
    case "plane":
      return {
        projectId: text("projectId", PATTERNS.planeProject, "That Plane project is not valid").toLowerCase(),
        projectName: text("projectName", /^.{1,200}$/, "That Plane project is not valid"),
        labels: labels(),
      }
    case "telegram":
      return { chatId: text("chatId", PATTERNS.chatId, "Enter a chat id, such as -1001234567890, or a channel's @name") }
    default:
      if (Object.keys(target).length > 0) throw invalid("This connection takes no target")
      return {}
  }
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
