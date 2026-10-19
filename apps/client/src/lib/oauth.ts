import type { AuthDeps } from "./auth"
import { safeNext } from "./urls"

const browserDeps: AuthDeps = {
  fetch: (url, init) => fetch(url, init),
  assign: (url) => window.location.assign(url),
}

/**
 * An AI app's sign-in sends people to /login with a signed copy of its request (`sig`). After signing
 * in they go back to the authorize endpoint with that same request, which then shows the consent page.
 */
export function oauthResumeUrl(search: string): string | null {
  const params = new URLSearchParams(search)
  if (!params.has("sig") || !params.has("client_id")) return null
  return `/api/auth/oauth2/authorize${search.startsWith("?") ? search : `?${search}`}`
}

/** Where to go after signing in: back to an AI app's request, else the usual `next`. */
export function loginTarget(search: string, next: unknown): string {
  return oauthResumeUrl(search) ?? safeNext(next)
}

/**
 * Where approving sends the browser (and the code that becomes the app's access): the host of the
 * app's redirect URI, or the whole URI for desktop apps with their own scheme. Anyone can register an
 * app with any name, so this is the one thing on the consent page the app cannot fake.
 */
export function redirectHost(search: string): string | null {
  const raw = new URLSearchParams(search).get("redirect_uri")
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.host || `${url.protocol}${url.pathname}`
  } catch {
    return raw
  }
}

const SCOPE_TEXT: Record<string, string> = {
  "bugberry:read": "Read reports, comments and debugger data in your workspaces",
  "bugberry:write": "Comment, change status, priority and assignee, and send reports to trackers",
}

/** What the app may do, in words; openid, profile and offline_access are plumbing, not permissions. */
export function scopeLines(scope: string): string[] {
  const asked = new Set(scope.split(/\s+/))
  return Object.entries(SCOPE_TEXT)
    .filter(([name]) => asked.has(name))
    .map(([, text]) => text)
}

export interface OAuthClientInfo {
  name: string
  uri: string | null
}

export async function fetchOAuthClient(clientId: string, deps: AuthDeps = browserDeps): Promise<OAuthClientInfo> {
  const response = await deps.fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, { method: "GET" })
  if (!response.ok) throw new Error("This app is not known to BugBerry. Start again from your AI app.")
  const body = (await response.json()) as { client_name?: unknown; client_uri?: unknown }
  return {
    name: typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim() : "An AI app",
    uri: typeof body.client_uri === "string" ? body.client_uri : null,
  }
}

/** Allows or denies the app; returns the app's redirect URL to send the browser to. */
export async function answerConsent(accept: boolean, search: string, deps: AuthDeps = browserDeps): Promise<string> {
  let response: Response
  try {
    response = await deps.fetch("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: search.replace(/^\?/, "") }),
    })
  } catch {
    throw new Error("BugBerry can't be reached. Check your connection and try again.")
  }
  const body = (await response.json().catch(() => null)) as { url?: unknown } | null
  if (!response.ok || typeof body?.url !== "string") throw new Error("This request has expired. Start again from your AI app.")
  return body.url
}
