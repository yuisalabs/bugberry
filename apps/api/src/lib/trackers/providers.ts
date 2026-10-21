import type { ActiveCollabConfig, GithubConfig, GitlabConfig, JiraConfig, LinearConfig, TrackerConfig, TrackerProvider } from "@bugberry/shared"
import { type IssueContent, renderHtml, renderMarkdown } from "./content"
import { type HostGuard, HostGuardError, NO_GUARD } from "../net/host-guard"

/** A failure whose message is safe to show to people (never contains the token). */
export class TrackerError extends Error {
  override name = "TrackerError"
}

export interface CreatedIssue {
  externalId: string
  url: string
}

export interface TrackerClient {
  test(): Promise<void>
  createIssue(content: IssueContent): Promise<CreatedIssue>
}

export type TrackerFactory = (provider: TrackerProvider, config: TrackerConfig, secret: string) => TrackerClient

export const DEFAULT_TIMEOUT_MS = 15_000

export interface Http {
  fetcher: typeof fetch
  timeoutMs: number
  /** Checks each address (and each redirect's) before it is called. */
  guard: HostGuard
}

const MAX_REDIRECTS = 3

async function request(http: Http, name: string, url: string, init: RequestInit): Promise<Response> {
  try {
    await http.guard(url)
  } catch (error) {
    throw new TrackerError(error instanceof HostGuardError ? error.message : `${name} could not be reached`)
  }
  try {
    return await http.fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(http.timeoutMs) })
  } catch (error) {
    const timedOut = (error as { name?: unknown } | null)?.name === "TimeoutError"
    if (!timedOut) throw new TrackerError(`${name} could not be reached`)
    // A create that timed out may still have gone through on the tracker's side.
    const creating = (init.method ?? "GET").toUpperCase() === "POST"
    throw new TrackerError(
      creating
        ? `${name} did not respond; the issue may have been created, check ${name} before sending again`
        : `${name} did not respond`,
    )
  }
}

/**
 * Redirects are followed by hand and only on the same origin: the token travels in a custom header
 * that fetch would forward to any host, and a redirect could also lead off https.
 */
export async function guardedSend(http: Http, name: string, url: string, init: RequestInit): Promise<Response> {
  const origin = new URL(url).origin
  let current = url
  for (let hop = 0; ; hop++) {
    const response = await request(http, name, current, init)
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get("location")
    const next = location ? new URL(location, current) : null
    const keepsMethod = response.status === 307 || response.status === 308
    const isGet = (init.method ?? "GET").toUpperCase() === "GET"
    if (!next || next.origin !== origin || hop >= MAX_REDIRECTS || (!keepsMethod && !isGet)) {
      throw new TrackerError(`${name} redirected to another address; check the integration's address`)
    }
    current = next.href
  }
}

async function remoteMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { message?: unknown }
  return typeof body.message === "string" ? `: ${body.message.slice(0, 200)}` : ""
}

function githubClient(config: GithubConfig, token: string, http: Http): TrackerClient {
  const base = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "BugBerry",
  }
  const fail = async (response: Response): Promise<never> => {
    if (response.status === 401) throw new TrackerError("The GitHub token is invalid or has expired")
    const rateLimited =
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))
    if (rateLimited) throw new TrackerError("GitHub is limiting requests, try again later")
    if (response.status === 403 || response.status === 404) {
      throw new TrackerError("The repo was not found or the token lacks Issues permission")
    }
    if (response.status === 410) throw new TrackerError("Issues are turned off for this repo")
    throw new TrackerError(`GitHub rejected the request (HTTP ${response.status})${await remoteMessage(response)}`)
  }

  return {
    /**
     * Reading the repo proves access, not that issues can be created. What can be checked here is:
     * Issues switched on, and for classic tokens (which list their scopes) the repo/public_repo scope.
     * Fine-grained tokens do not reveal their permissions; those are checked by the first send.
     */
    async test() {
      const response = await guardedSend(http, "GitHub", base, { headers })
      if (!response.ok) await fail(response)
      const repo = (await response.json().catch(() => ({}))) as { private?: unknown; has_issues?: unknown }
      if (repo.has_issues === false) throw new TrackerError("Issues are turned off for this repo")
      const scopesHeader = response.headers.get("x-oauth-scopes")
      if (scopesHeader !== null) {
        const scopes = scopesHeader.split(",").map((scope) => scope.trim())
        const enough = scopes.includes("repo") || (repo.private !== true && scopes.includes("public_repo"))
        if (!enough) {
          throw new TrackerError(
            repo.private === true
              ? "A GitHub (classic) token needs the repo scope to create issues in a private repo"
              : "A GitHub (classic) token needs the public_repo or repo scope to create issues",
          )
        }
      }
    },
    async createIssue(content) {
      const response = await guardedSend(http, "GitHub", `${base}/issues`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title: content.title.slice(0, 256), body: renderMarkdown(content), labels: config.labels }),
      })
      if (!response.ok) await fail(response)
      const issue = (await response.json()) as { number?: unknown; html_url?: unknown }
      if (typeof issue.number !== "number" || typeof issue.html_url !== "string") {
        throw new TrackerError("GitHub's response was not recognized")
      }
      return { externalId: String(issue.number), url: issue.html_url }
    },
  }
}

function activeCollabClient(config: ActiveCollabConfig, token: string, http: Http): TrackerClient {
  const base = config.baseUrl.replace(/\/+$/, "")
  const projectApi = `${base}/api/v1/projects/${config.projectId}`
  const headers = { "x-angie-authapitoken": token, accept: "application/json" }
  const fail = async (response: Response): Promise<never> => {
    if (response.status === 401 || response.status === 403) {
      throw new TrackerError("The ActiveCollab token is invalid or has no access to the project")
    }
    if (response.status === 404) throw new TrackerError("The ActiveCollab project or task list was not found")
    throw new TrackerError(`ActiveCollab rejected the request (HTTP ${response.status})${await remoteMessage(response)}`)
  }

  return {
    async test() {
      const response = await guardedSend(http, "ActiveCollab", projectApi, { headers })
      if (!response.ok) await fail(response)
    },
    async createIssue(content) {
      const response = await guardedSend(http, "ActiveCollab", `${projectApi}/tasks`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ name: content.title.slice(0, 150), body: renderHtml(content), task_list_id: config.taskListId }),
      })
      if (!response.ok) await fail(response)
      const task = ((await response.json()) as { single?: { id?: unknown; url_path?: unknown } }).single
      if (typeof task?.id !== "number") throw new TrackerError("ActiveCollab's response was not recognized")
      const path =
        typeof task.url_path === "string" && task.url_path.startsWith("/") && !task.url_path.startsWith("//")
          ? task.url_path
          : `/projects/${config.projectId}/tasks/${task.id}`
      return { externalId: String(task.id), url: `${base}${path}` }
    },
  }
}

function gitlabClient(config: GitlabConfig, token: string, http: Http): TrackerClient {
  const project = `${config.baseUrl.replace(/\/+$/, "")}/api/v4/projects/${encodeURIComponent(config.projectPath)}`
  const headers = { "private-token": token, accept: "application/json", "user-agent": "BugBerry" }
  const fail = async (response: Response): Promise<never> => {
    if (response.status === 401) throw new TrackerError("The GitLab token is invalid or has expired")
    if (response.status === 403 || response.status === 404) {
      throw new TrackerError("The GitLab project was not found or the token lacks the api scope")
    }
    if (response.status === 429) throw new TrackerError("GitLab is limiting requests, try again later")
    throw new TrackerError(`GitLab rejected the request (HTTP ${response.status})${await remoteMessage(response)}`)
  }

  return {
    /** Reading the project proves the token sees it; issues must also be switched on. */
    async test() {
      const response = await guardedSend(http, "GitLab", project, { headers })
      if (!response.ok) await fail(response)
      const body = (await response.json().catch(() => ({}))) as { issues_enabled?: unknown }
      if (body.issues_enabled === false) throw new TrackerError("Issues are turned off for this GitLab project")
    },
    async createIssue(content) {
      const response = await guardedSend(http, "GitLab", `${project}/issues`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title: content.title.slice(0, 255), description: renderMarkdown(content), labels: config.labels.join(",") }),
      })
      if (!response.ok) await fail(response)
      const issue = (await response.json()) as { iid?: unknown; web_url?: unknown }
      if (typeof issue.iid !== "number" || typeof issue.web_url !== "string") {
        throw new TrackerError("GitLab's response was not recognized")
      }
      return { externalId: String(issue.iid), url: issue.web_url }
    },
  }
}

const LINEAR_API = "https://api.linear.app/graphql"
const LINEAR_TEAM = `query Team($key: String!) {
  teams(filter: { key: { eq: $key } }) { nodes { id labels { nodes { id name } } } }
}`
const LINEAR_CREATE = `mutation Create($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier url } }
}`

function linearClient(config: LinearConfig, apiKey: string, http: Http): TrackerClient {
  /** One GraphQL call; Linear answers errors in the body, sometimes with HTTP 400. */
  const graphql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const response = await guardedSend(http, "Linear", LINEAR_API, {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json", "user-agent": "BugBerry" },
      body: JSON.stringify({ query, variables }),
    })
    const body = (await response.json().catch(() => ({}))) as {
      data?: T
      errors?: Array<{ message?: unknown; extensions?: { code?: unknown } }>
    }
    const [error] = body.errors ?? []
    if (response.status === 401 || error?.extensions?.code === "AUTHENTICATION_ERROR") {
      throw new TrackerError("The Linear API key is invalid")
    }
    if (error) throw new TrackerError(`Linear: ${String(error.message ?? "the request failed").slice(0, 200)}`)
    if (!response.ok || !body.data) throw new TrackerError(`Linear rejected the request (HTTP ${response.status})`)
    return body.data
  }
  type Team = { id: string; labels: { nodes: Array<{ id: string; name: string }> } }
  const team = async (): Promise<Team> => {
    const data = await graphql<{ teams: { nodes: Team[] } }>(LINEAR_TEAM, { key: config.teamKey })
    const [found] = data.teams.nodes
    if (!found) throw new TrackerError(`Linear team ${config.teamKey} was not found`)
    return found
  }

  return {
    async test() {
      await team()
    },
    async createIssue(content) {
      const { id, labels } = await team()
      // Labels are matched by name; one the team doesn't have is left out rather than failing the issue.
      const wanted = new Set(config.labels.map((label) => label.toLowerCase()))
      const labelIds = labels.nodes.filter((label) => wanted.has(label.name.toLowerCase())).map((label) => label.id)
      const data = await graphql<{ issueCreate: { success: boolean; issue: { identifier?: unknown; url?: unknown } | null } }>(
        LINEAR_CREATE,
        { input: { teamId: id, title: content.title.slice(0, 255), description: renderMarkdown(content), labelIds } },
      )
      const issue = data.issueCreate.issue
      if (!data.issueCreate.success || typeof issue?.identifier !== "string" || typeof issue.url !== "string") {
        throw new TrackerError("Linear's response was not recognized")
      }
      return { externalId: issue.identifier, url: issue.url }
    },
  }
}

export function createTrackerFactory(
  fetcher: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  guard: HostGuard = NO_GUARD,
): TrackerFactory {
  const http = { fetcher, timeoutMs, guard }
  return (provider, config, secret) => {
    if (provider === "github" && "owner" in config) return githubClient(config, secret, http)
    if (provider === "activecollab" && "projectId" in config) return activeCollabClient(config, secret, http)
    if (provider === "gitlab" && "projectPath" in config) return gitlabClient(config, secret, http)
    if (provider === "linear" && "teamKey" in config) return linearClient(config, secret, http)
    throw new TrackerError("The integration settings don't match its provider")
  }
}
