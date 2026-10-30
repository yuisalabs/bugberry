/** The BugBerry server the extension sends to; the dashboard's sign-in cookie does the rest. */
export interface Settings {
  serverUrl: string
}

export class SettingsError extends Error {
  override name = "SettingsError"
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/** The server's origin. Plain http is allowed only for this machine, so sessions never cross a network unencrypted. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new SettingsError("That server address isn't valid")
  }
  if (url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw new SettingsError("Use https:// (http is only for localhost)")
  }
  return url.origin
}

/** BugBerry's own server, the one the store builds use. */
export { BUGBERRY_CLOUD_ORIGIN } from "@bugberry/shared"

/** The server given at build time (VITE_SERVER_ORIGIN), used until another server is chosen. */
export function defaultServerUrl(raw: string | undefined): string {
  if (!raw?.trim()) return ""
  try {
    return normalizeServerUrl(raw)
  } catch {
    return ""
  }
}

export interface SettingsStorage {
  get(): Promise<{ serverUrl?: string }>
  set(value: Settings): Promise<void>
  clear(): Promise<void>
  /** Older versions stored a token next to the server; it is no longer used. */
  removeLegacyToken(): Promise<void>
}

/** The chosen server, else the build-time one, else none (the person has to choose). */
export async function loadSettings(storage: SettingsStorage, buildDefault: string): Promise<Settings | null> {
  const stored = await storage.get()
  if (stored.serverUrl) return { serverUrl: stored.serverUrl }
  const fallback = defaultServerUrl(buildDefault)
  return fallback ? { serverUrl: fallback } : null
}
