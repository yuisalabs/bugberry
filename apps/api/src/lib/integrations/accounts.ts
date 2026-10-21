import type { ConnectionSettings, IntegrationProvider } from "@bugberry/shared"
import { PROVIDER_LABELS } from "@bugberry/shared"
import type { AppDeps } from "../../app"
import { createHostGuard, type HostGuard } from "../net/host-guard"
import { DEFAULT_TIMEOUT_MS, guardedSend, type Http, TrackerError } from "../trackers/providers"

export type OptionList = "targets" | "labels" | "issueTypes" | "taskLists"
export const OPTION_LISTS = ["targets", "labels", "issueTypes", "taskLists"] as const

export interface Option {
  value: string
  label: string
}

/** What a workspace connection can do without a project: check its account, and list what a project may pick. */
export interface AccountClient {
  check(): Promise<void>
  list(list: OptionList, opts: { q?: string; parent?: string }): Promise<Option[]>
}

export type AccountFactory = (provider: IntegrationProvider, settings: ConnectionSettings, secret: string) => AccountClient

/** A list the provider does not have, such as ActiveCollab labels; answered as 422 list_unavailable. */
export class ListUnavailableError extends Error {
  override name = "ListUnavailableError"
}

const MAX_OPTIONS = 100
const GITHUB_SEARCH_PAGES = 10

/** Keeps options matching `q` (case-insensitive, value or label) and stops at 100. */
function finish(options: Option[], q?: string): Option[] {
  const needle = q?.trim().toLowerCase()
  const matching = needle
    ? options.filter((option) => option.value.toLowerCase().includes(needle) || option.label.toLowerCase().includes(needle))
    : options
  return matching.slice(0, MAX_OPTIONS)
}

const same = (value: string): Option => ({ value, label: value })

type Fail = (response: Response) => Promise<never>

/** A GET (or a POST for GraphQL) through the guard; a non-2xx answer goes to `fail`. */
async function call<T>(http: Http, name: string, url: string, init: RequestInit, fail: Fail): Promise<T> {
  const response = await guardedSend(http, name, url, init)
  if (!response.ok) return fail(response)
  return (await response.json().catch(() => {
    throw new TrackerError(`${name}'s response was not recognized`)
  })) as T
}

function rejected(name: string, unauthorized: string): Fail {
  return async (response) => {
    if (response.status === 401) throw new TrackerError(unauthorized)
    if (response.status === 429) throw new TrackerError(`${name} is limiting requests, try again later`)
    throw new TrackerError(`${name} rejected the request (HTTP ${response.status})`)
  }
}

function unavailable(provider: IntegrationProvider, list: OptionList): never {
  throw new ListUnavailableError(`${PROVIDER_LABELS[provider]} has no ${list === "taskLists" ? "task lists" : list === "issueTypes" ? "issue types" : list} list`)
}

const needParent = (parent: string | undefined): string => {
  if (!parent) throw new ListUnavailableError("Pick the parent first")
  return parent
}

function github(token: string, http: Http): AccountClient {
  const base = "https://api.github.com"
  const init = { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "BugBerry" } }
  const fail = rejected("GitHub", "The GitHub token is invalid or has expired")
  return {
    async check() {
      await call(http, "GitHub", `${base}/user`, init, fail)
    },
    async list(list, { q, parent }) {
      if (list === "targets") {
        const url = `${base}/user/repos?per_page=100&sort=updated`
        if (!q?.trim()) {
          const repos = await call<Array<{ full_name: string }>>(http, "GitHub", url, init, fail)
          return finish(repos.map((repo) => same(repo.full_name)), q)
        }
        // GitHub cannot search a token's own repositories, so a search reads up to 1,000 of them, newest first.
        const repos: Array<{ full_name: string }> = []
        for (let page = 1; page <= GITHUB_SEARCH_PAGES; page++) {
          const batch = await call<Array<{ full_name: string }>>(http, "GitHub", `${url}&page=${page}`, init, fail)
          repos.push(...batch)
          if (batch.length < 100) break
        }
        return finish(repos.map((repo) => same(repo.full_name)), q)
      }
      if (list === "labels") {
        const repo = needParent(parent).split("/").map(encodeURIComponent).join("/")
        const labels = await call<Array<{ name: string }>>(http, "GitHub", `${base}/repos/${repo}/labels?per_page=100`, init, fail)
        return finish(labels.map((label) => same(label.name)), q)
      }
      return unavailable("github", list)
    },
  }
}

function gitlab(settings: { baseUrl: string }, token: string, http: Http): AccountClient {
  const base = `${settings.baseUrl.replace(/\/+$/, "")}/api/v4`
  const init = { headers: { "private-token": token, accept: "application/json", "user-agent": "BugBerry" } }
  const fail = rejected("GitLab", "The GitLab token is invalid or has expired")
  return {
    async check() {
      await call(http, "GitLab", `${base}/user`, init, fail)
    },
    async list(list, { q, parent }) {
      if (list === "targets") {
        const search = q?.trim() ? `&search=${encodeURIComponent(q.trim())}` : ""
        const url = `${base}/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at${search}`
        const projects = await call<Array<{ path_with_namespace: string }>>(http, "GitLab", url, init, fail)
        return finish(projects.map((project) => same(project.path_with_namespace)), q)
      }
      if (list === "labels") {
        const url = `${base}/projects/${encodeURIComponent(needParent(parent))}/labels?per_page=100`
        const labels = await call<Array<{ name: string }>>(http, "GitLab", url, init, fail)
        return finish(labels.map((label) => same(label.name)), q)
      }
      return unavailable("gitlab", list)
    },
  }
}

const LINEAR_API = "https://api.linear.app/graphql"
const LINEAR_TEAMS = "query { teams(first: 100) { nodes { key name } } }"
const LINEAR_TEAM_LABELS = `query TeamLabels($key: String!) {
  teams(filter: { key: { eq: $key } }) { nodes { id key labels(first: 100) { nodes { id name } } } }
}`

function linear(apiKey: string, http: Http): AccountClient {
  const graphql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const response = await guardedSend(http, "Linear", LINEAR_API, {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json", "user-agent": "BugBerry" },
      body: JSON.stringify({ query, variables }),
    })
    const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message?: unknown; extensions?: { code?: unknown } }> }
    const error = body.errors?.[0]
    if (response.status === 401 || error?.extensions?.code === "AUTHENTICATION_ERROR") throw new TrackerError("The Linear API key is invalid")
    if (error) throw new TrackerError(`Linear: ${String(error.message ?? "the request failed").slice(0, 200)}`)
    if (!response.ok || !body.data) throw new TrackerError(`Linear rejected the request (HTTP ${response.status})`)
    return body.data
  }
  return {
    async check() {
      await graphql("query { viewer { id } }")
    },
    async list(list, { q, parent }) {
      if (list === "targets") {
        const data = await graphql<{ teams: { nodes: Array<{ key: string; name: string }> } }>(LINEAR_TEAMS)
        return finish(data.teams.nodes.map((team) => ({ value: team.key, label: `${team.name} (${team.key})` })), q)
      }
      if (list === "labels") {
        const data = await graphql<{ teams: { nodes: Array<{ labels: { nodes: Array<{ name: string }> } }> } }>(LINEAR_TEAM_LABELS, {
          key: needParent(parent).toUpperCase(),
        })
        const team = data.teams.nodes[0]
        if (!team) throw new TrackerError(`Linear team ${parent} was not found`)
        return finish(team.labels.nodes.map((label) => same(label.name)), q)
      }
      return unavailable("linear", list)
    },
  }
}

function jira(settings: { siteUrl: string; email: string }, apiToken: string, http: Http): AccountClient {
  const site = settings.siteUrl.replace(/\/+$/, "")
  const init = { headers: { authorization: `Basic ${btoa(`${settings.email}:${apiToken}`)}`, accept: "application/json", "user-agent": "BugBerry" } }
  const fail = rejected("Jira", "The Jira email or API token is wrong")
  return {
    async check() {
      await call(http, "Jira", `${site}/rest/api/3/myself`, init, fail)
    },
    async list(list, { q, parent }) {
      if (list === "targets") {
        const query = q?.trim() ? `&query=${encodeURIComponent(q.trim())}` : ""
        const page = await call<{ values: Array<{ key: string; name: string }> }>(
          http,
          "Jira",
          `${site}/rest/api/3/project/search?maxResults=100${query}`,
          init,
          fail,
        )
        return finish(page.values.map((project) => ({ value: project.key, label: `${project.name} (${project.key})` })), q)
      }
      if (list === "issueTypes") {
        const project = await call<{ issueTypes?: Array<{ name: string }> }>(
          http,
          "Jira",
          `${site}/rest/api/3/project/${encodeURIComponent(needParent(parent))}`,
          init,
          fail,
        )
        return finish((project.issueTypes ?? []).map((type) => same(type.name)), q)
      }
      if (list === "labels") {
        const page = await call<{ values: string[] }>(http, "Jira", `${site}/rest/api/3/label?maxResults=1000`, init, fail)
        return finish(page.values.map(same), q)
      }
      return unavailable("jira", list)
    },
  }
}

function activeCollab(settings: { baseUrl: string }, token: string, http: Http): AccountClient {
  const base = `${settings.baseUrl.replace(/\/+$/, "")}/api/v1`
  const init = { headers: { "x-angie-authapitoken": token, accept: "application/json", "user-agent": "BugBerry" } }
  const fail = rejected("ActiveCollab", "The ActiveCollab token is invalid")
  type Named = Array<{ id: number; name: string }>
  const named = (body: Named | { task_lists?: Named }) => (Array.isArray(body) ? body : (body.task_lists ?? []))
  return {
    async check() {
      await call(http, "ActiveCollab", `${base}/projects`, init, fail)
    },
    async list(list, { q, parent }) {
      if (list === "targets") {
        const projects = await call<Named>(http, "ActiveCollab", `${base}/projects`, init, fail)
        return finish(projects.map((project) => ({ value: String(project.id), label: project.name })), q)
      }
      if (list === "taskLists") {
        const url = `${base}/projects/${encodeURIComponent(needParent(parent))}/task-lists`
        const lists = named(await call<Named | { task_lists?: Named }>(http, "ActiveCollab", url, init, fail))
        return finish(lists.map((item) => ({ value: String(item.id), label: item.name })), q)
      }
      return unavailable("activecollab", list)
    },
  }
}

function telegram(token: string, http: Http): AccountClient {
  return {
    async check() {
      const response = await guardedSend(http, "Telegram", `https://api.telegram.org/bot${token}/getMe`, {})
      const body = (await response.json().catch(() => ({}))) as { ok?: unknown }
      if (response.status === 401 || response.status === 404) throw new TrackerError("The Telegram bot token is wrong")
      if (!response.ok || body.ok !== true) throw new TrackerError(`Telegram rejected the request (HTTP ${response.status})`)
    },
    async list(list) {
      return unavailable("telegram", list)
    },
  }
}

/** Slack, Discord and webhook connections are tested by posting a message instead. */
function nothing(provider: IntegrationProvider): AccountClient {
  return {
    async check() {
      throw new TrackerError(`Send a test message to check ${PROVIDER_LABELS[provider]}`)
    },
    async list(list) {
      return unavailable(provider, list)
    },
  }
}

export function createAccountFactory(fetcher: typeof fetch, timeoutMs: number, guard: HostGuard): AccountFactory {
  const http = { fetcher, timeoutMs, guard }
  return (provider, settings, secret) => {
    // The empty settings type stops `in` from narrowing, so the shape is checked by hand.
    const { baseUrl, siteUrl, email } = settings as Partial<{ baseUrl: string; siteUrl: string; email: string }>
    if (provider === "github") return github(secret, http)
    if (provider === "gitlab" && baseUrl) return gitlab({ baseUrl }, secret, http)
    if (provider === "linear") return linear(secret, http)
    if (provider === "jira" && siteUrl && email) return jira({ siteUrl, email }, secret, http)
    if (provider === "activecollab" && baseUrl) return activeCollab({ baseUrl }, secret, http)
    if (provider === "telegram") return telegram(secret, http)
    if (provider === "slack" || provider === "discord" || provider === "webhook") return nothing(provider)
    throw new TrackerError("The connection settings don't match its provider")
  }
}

/** The app's account factory: the one a test gave, or the real one behind the private-network guard. */
export function accountFactoryFor(deps: Pick<AppDeps, "accounts" | "config">): AccountFactory {
  return (
    deps.accounts ??
    createAccountFactory(fetch, DEFAULT_TIMEOUT_MS, createHostGuard({ allowPrivate: deps.config.allowPrivateIntegrationHosts }))
  )
}
