import { browser } from "wxt/browser"
import { createCapturePrefsStorage } from "./capture-prefs"
import { defaultServerUrl, type SettingsStorage } from "./settings"

/** BugBerry cloud for a store build; empty for a build without VITE_SERVER_ORIGIN. */
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
