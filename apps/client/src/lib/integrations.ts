import { type IntegrationConfig, type IntegrationProvider, PROVIDER_LABELS } from "@bugberry/shared"

export interface IntegrationFields {
  owner: string
  repo: string
  labels: string
  /** ActiveCollab's or GitLab's address. */
  baseUrl: string
  projectId: string
  taskListId: string
  projectPath: string
  teamKey: string
  siteUrl: string
  email: string
  projectKey: string
  issueType: string
  chatId: string
  /** The generic webhook's address. */
  url: string
}

export const EMPTY_FIELDS: IntegrationFields = {
  owner: "",
  repo: "",
  labels: "",
  baseUrl: "",
  projectId: "",
  taskListId: "",
  projectPath: "",
  teamKey: "",
  siteUrl: "",
  email: "",
  projectKey: "",
  issueType: "",
  chatId: "",
  url: "",
}

type Result = { ok: true; config: IntegrationConfig } | { ok: false; error: string }

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const PROJECT_PATH = /^[\w.-]+(?:\/[\w.-]+)+$/
const TEAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,9}$/
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{1,9}$/
const EMAIL = /^[^\s@]+@[^\s@]+$/
const CHAT_ID = /^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/
const JIRA_SITE = /^https:\/\/[a-z0-9][a-z0-9-]*\.atlassian\.net$/i
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
/** Where each chat service's incoming webhooks live, as the server checks them. */
const WEBHOOK_HOSTS: Partial<Record<IntegrationProvider, { hosts: string[]; path: string }>> = {
  slack: { hosts: ["hooks.slack.com"], path: "/services/" },
  discord: { hosts: ["discord.com", "discordapp.com"], path: "/api/webhooks/" },
}

function positiveInteger(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const number = Number(trimmed)
  return number >= 1 ? number : null
}

function cleanLabels(raw: string): string[] | null {
  const labels = [
    ...new Set(
      raw
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ]
  return labels.length > 10 || labels.some((label) => label.length > 50) ? null : labels
}

const LABELS_ERROR = "Use at most 10 labels of up to 50 characters each"

/** https (plain http only on this machine), no login, query or fragment. */
function secureUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
  return secure && !url.username && !url.password && !url.hash ? url : null
}

/** An address as the server stores it: no query, no trailing slash. */
function baseUrl(raw: string): string | null {
  const url = secureUrl(raw)
  return url && !url.search ? `${url.origin}${url.pathname.replace(/\/+$/, "")}` : null
}

/** Mirrors the server's checks so mistakes show up before saving. */
export function validateIntegration(provider: IntegrationProvider, fields: IntegrationFields): Result {
  const labels = cleanLabels(fields.labels)
  switch (provider) {
    case "github": {
      const owner = fields.owner.trim()
      const repo = fields.repo.trim()
      if (!OWNER.test(owner)) return { ok: false, error: "The GitHub owner is invalid" }
      if (!REPO.test(repo)) return { ok: false, error: "The repo name is invalid" }
      if (!labels) return { ok: false, error: LABELS_ERROR }
      return { ok: true, config: { owner, repo, labels } }
    }
    case "activecollab": {
      const address = baseUrl(fields.baseUrl)
      if (!address) return { ok: false, error: "The ActiveCollab address must start with https:// and have no query" }
      const projectId = positiveInteger(fields.projectId)
      const taskListId = positiveInteger(fields.taskListId)
      if (!projectId || !taskListId) return { ok: false, error: "Project ID and task list ID must be positive whole numbers" }
      return { ok: true, config: { baseUrl: address, projectId, taskListId } }
    }
    case "gitlab": {
      const address = baseUrl(fields.baseUrl)
      if (!address) return { ok: false, error: "The GitLab address must start with https:// and have no query" }
      const projectPath = fields.projectPath.trim().replace(/^\/+|\/+$/g, "")
      if (!PROJECT_PATH.test(projectPath)) return { ok: false, error: "Enter the project path as group/project" }
      if (!labels) return { ok: false, error: LABELS_ERROR }
      return { ok: true, config: { baseUrl: address, projectPath, labels } }
    }
    case "linear": {
      const teamKey = fields.teamKey.trim()
      if (!TEAM_KEY.test(teamKey)) return { ok: false, error: "Enter the team key, such as ENG" }
      if (!labels) return { ok: false, error: LABELS_ERROR }
      return { ok: true, config: { teamKey: teamKey.toUpperCase(), labels } }
    }
    case "jira": {
      const siteUrl = baseUrl(fields.siteUrl)
      if (!siteUrl || !JIRA_SITE.test(siteUrl)) {
        return { ok: false, error: "Use your Jira Cloud address, such as https://yourteam.atlassian.net" }
      }
      const email = fields.email.trim()
      if (!EMAIL.test(email)) return { ok: false, error: "Enter the email of the Atlassian account" }
      const projectKey = fields.projectKey.trim()
      if (!PROJECT_KEY.test(projectKey)) return { ok: false, error: "Enter the project key, such as BUG" }
      const issueType = fields.issueType.trim()
      if (!issueType || issueType.length > 60) return { ok: false, error: "Enter an issue type, such as Bug" }
      if (!labels) return { ok: false, error: LABELS_ERROR }
      return { ok: true, config: { siteUrl: siteUrl.toLowerCase(), email, projectKey: projectKey.toUpperCase(), issueType, labels } }
    }
    case "slack":
    case "discord":
      return { ok: true, config: {} }
    case "telegram": {
      const chatId = fields.chatId.trim()
      if (!CHAT_ID.test(chatId)) return { ok: false, error: "Enter a chat id, such as -1001234567890, or a channel's @name" }
      return { ok: true, config: { chatId } }
    }
    case "webhook": {
      const url = secureUrl(fields.url)
      if (!url) return { ok: false, error: "The webhook address must use https://" }
      return { ok: true, config: { url: url.href } }
    }
  }
}

/** Slack and Discord keep the channel in their webhook URL, which must point at that service. Null when fine. */
export function validateSecret(provider: IntegrationProvider, secret: string): string | null {
  const rule = WEBHOOK_HOSTS[provider]
  if (!rule) return null
  let url: URL
  try {
    url = new URL(secret.trim())
  } catch {
    return `Paste the ${PROVIDER_LABELS[provider]} webhook URL`
  }
  const ok = url.protocol === "https:" && rule.hosts.includes(url.hostname) && url.pathname.startsWith(rule.path)
  return ok ? null : `That is not a ${PROVIDER_LABELS[provider]} webhook URL`
}
