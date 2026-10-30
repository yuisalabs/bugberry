import { browser } from "wxt/browser"
import { createCapturePrefsStorage } from "../capture/capture-prefs"
import type { SessionState } from "./session"
import { defaultServerUrl, type SettingsStorage } from "./settings"

/** The server built in: BugBerry cloud for a store build, a self-hoster's own, or empty without VITE_SERVER_ORIGIN. */
export const BUILD_SERVER_ORIGIN = defaultServerUrl((import.meta.env as Record<string, string | undefined>).VITE_SERVER_ORIGIN)

export const browserSettingsStorage: SettingsStorage = {
  async get() {
    return (await browser.storage.local.get("serverUrl")) as { serverUrl?: string }
  },
  async set(value) {
    await browser.storage.local.set({ serverUrl: value.serverUrl })
  },
  async clear() {
    await browser.storage.local.remove("serverUrl")
  },
  async removeLegacyToken() {
    await browser.storage.local.remove("token")
  },
}

/** Whether the reporter chose "Include my city"; the browser remembers the permission itself. */
export const includeCityStorage = {
  async get(): Promise<boolean> {
    const { includeCity } = (await browser.storage.local.get("includeCity")) as { includeCity?: unknown }
    return includeCity === true
  },
  async set(includeCity: boolean): Promise<void> {
    await browser.storage.local.set({ includeCity })
  },
}

/**
 * Where the session stood when the popup last checked, for that server. The popup starts from it while it asks
 * again, so it opens at its real size instead of jumping from the capture tiles to "Sign in".
 */
export const lastSessionStorage = {
  async get(serverUrl: string): Promise<SessionState | null> {
    const { lastSession } = (await browser.storage.local.get("lastSession")) as { lastSession?: { serverUrl?: unknown; session?: unknown } }
    return lastSession?.serverUrl === serverUrl ? sessionFrom(lastSession.session) : null
  },
  async set(serverUrl: string, session: SessionState): Promise<void> {
    await browser.storage.local.set({ lastSession: { serverUrl, session } })
  },
}

/** A stored session, or null when it isn't one (an older or damaged entry). */
export function sessionFrom(value: unknown): SessionState | null {
  const stored = value as Record<string, unknown> | null | undefined
  if (stored?.kind === "signed-out" || stored?.kind === "no-server") return { kind: stored.kind }
  if (stored?.kind === "signed-in" && typeof stored.name === "string" && typeof stored.email === "string") {
    return { kind: "signed-in", name: stored.name, email: stored.email }
  }
  if (stored?.kind === "unreachable" && typeof stored.host === "string") return { kind: "unreachable", host: stored.host }
  return null
}

/** The workspace the last report was sent to, so the next one starts there. */
export const lastWorkspaceStorage = {
  async get(): Promise<string | null> {
    const { lastWorkspaceId } = (await browser.storage.local.get("lastWorkspaceId")) as { lastWorkspaceId?: string }
    return lastWorkspaceId ?? null
  },
  async set(workspaceId: string): Promise<void> {
    await browser.storage.local.set({ lastWorkspaceId: workspaceId })
  },
}

/** The popup's screenshot and record choices, also used by the shortcuts. */
export const capturePrefsStorage = createCapturePrefsStorage({
  get: (key) => browser.storage.local.get(key) as Promise<Record<string, unknown>>,
  set: (items) => browser.storage.local.set(items),
})
