import { type ConnectionSettings, type IntegrationProvider, PROVIDER_LABELS } from "@bugberry/shared"

/** What a connection form asks for besides the secret: an account's address or login. */
export interface ConnectionFields {
  /** GitLab's or ActiveCollab's address. */
  baseUrl: string
  siteUrl: string
  email: string
  /** The generic webhook's address. */
  url: string
  /** Plane's workspace part of its URLs: "my-team" in app.plane.so/my-team/projects. */
  workspaceSlug: string
}

export const EMPTY_FIELDS: ConnectionFields = { baseUrl: "", siteUrl: "", email: "", url: "", workspaceSlug: "" }

const EMAIL = /^[^\s@]+@[^\s@]+$/
const WORKSPACE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const CHAT_ID = /^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/
const JIRA_SITE = /^https:\/\/[a-z0-9][a-z0-9-]*\.atlassian\.net$/i
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
/** Where each chat service's incoming webhooks live, as the server checks them. */
const WEBHOOK_HOSTS: Partial<Record<IntegrationProvider, { hosts: string[]; path: string }>> = {
  slack: { hosts: ["hooks.slack.com"], path: "/services/" },
  discord: { hosts: ["discord.com", "discordapp.com"], path: "/api/webhooks/" },
}

/** https (plain http only on this machine), no login or fragment. */
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

/** Mirrors the server's checks on a connection's settings, so mistakes show up before saving. */
export function validateConnection(
  provider: IntegrationProvider,
  fields: ConnectionFields,
): { ok: true; settings: ConnectionSettings } | { ok: false; error: string } {
  if (provider === "plane") {
    const address = baseUrl(fields.baseUrl)
    if (!address) return { ok: false, error: "The Plane address must start with https:// and have no query" }
    const workspaceSlug = fields.workspaceSlug.trim()
    if (!WORKSPACE_SLUG.test(workspaceSlug)) return { ok: false, error: "Enter the workspace slug from your Plane address" }
    return { ok: true, settings: { baseUrl: address, workspaceSlug } }
  }
  if (provider === "gitlab" || provider === "activecollab") {
    const address = baseUrl(fields.baseUrl)
    if (!address) return { ok: false, error: `The ${PROVIDER_LABELS[provider]} address must start with https:// and have no query` }
    return { ok: true, settings: { baseUrl: address } }
  }
  if (provider === "jira") {
    const siteUrl = baseUrl(fields.siteUrl)
    if (!siteUrl || !JIRA_SITE.test(siteUrl)) {
      return { ok: false, error: "Use your Jira Cloud address, such as https://yourteam.atlassian.net" }
    }
    const email = fields.email.trim()
    if (!EMAIL.test(email)) return { ok: false, error: "Enter the email of the Atlassian account" }
    return { ok: true, settings: { siteUrl: siteUrl.toLowerCase(), email } }
  }
  if (provider === "webhook") {
    const url = secureUrl(fields.url)
    if (!url) return { ok: false, error: "The webhook address must use https://" }
    return { ok: true, settings: { url: url.href } }
  }
  return { ok: true, settings: {} }
}

/** A Telegram group's numeric id or a channel's @name, trimmed; null when it is neither. */
export function validateChatId(raw: string): string | null {
  const chatId = raw.trim()
  return CHAT_ID.test(chatId) ? chatId : null
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
