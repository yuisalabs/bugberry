import { ApiError } from "./api"
import { BUGBERRY_CLOUD_ORIGIN, type Settings } from "./settings"

export type SessionState =
  | { kind: "signed-in"; name: string; email: string }
  | { kind: "signed-out" }
  | { kind: "unreachable"; host: string }
  | { kind: "no-server" }

/** Where the dashboard session stands for the active server. */
export async function checkSession(
  settings: Settings | null,
  me: () => Promise<{ name: string; email: string }>,
): Promise<SessionState> {
  if (!settings) return { kind: "no-server" }
  try {
    const { name, email } = await me()
    return { kind: "signed-in", name, email }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { kind: "signed-out" }
    return { kind: "unreachable", host: new URL(settings.serverUrl).host }
  }
}

const METHOD_KEYS = ["github", "gitlab", "google", "emailOtp"] as const

/** True when the address answers like a BugBerry server: its public list of sign-in methods. */
export async function isBugBerryServer(serverUrl: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${serverUrl}/api/auth-methods`)
    if (!response.ok) return false
    const body = (await response.json()) as Record<string, unknown> | null
    return typeof body === "object" && body !== null && METHOD_KEYS.every((key) => typeof body[key] === "boolean")
  } catch {
    return false
  }
}

export function signInUrl(serverUrl: string): string {
  return `${serverUrl}/login`
}

/**
 * "BugBerry cloud" for BugBerry's own server, otherwise the server's host. Not the build-time server: a self-hosted
 * or local build bakes in its own (VITE_SERVER_ORIGIN), and calling that BugBerry cloud hid where reports go.
 */
export function serverLabel(serverUrl: string): string {
  const url = new URL(serverUrl)
  return url.origin === BUGBERRY_CLOUD_ORIGIN ? "BugBerry cloud" : url.host
}
