import { browser } from "wxt/browser"
import type { DraftStore } from "../../lib/drafts/draft-store"
import { draftLock } from "../../lib/drafts/draft-lock"
import { OUTBOX_ALARM } from "../../lib/drafts/outbox"
import { createOutboxRunner } from "../../lib/drafts/outbox-runner"
import { fetchPut, putFile } from "../../lib/review/upload"
import { createBugberryApi } from "../../lib/server/api"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage, lastWorkspaceStorage, sentAwayStorage } from "../../lib/server/browser-settings"
import { loadSettings } from "../../lib/server/settings"

/**
 * Registers what wakes the queue (its alarm, reconnecting, browser start, install) and answers the flush.
 * Called synchronously at the top of the background, so a woken service worker gets its event.
 */
export function startOutbox(store: DraftStore): () => Promise<void> {
  const outbox = createOutboxRunner({
    store,
    settings: () => loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN),
    apiFor: (settings) => createBugberryApi(settings),
    uploadDeps: (settings) => ({
      api: createBugberryApi(settings),
      store,
      putFile: (target, body) => putFile(target, body, undefined, fetchPut),
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      lock: draftLock,
      serverUrl: settings.serverUrl,
    }),
    online: () => navigator.onLine,
    now: () => Date.now(),
    sentAway: sentAwayStorage,
    setLastWorkspace: (id) => lastWorkspaceStorage.set(id),
  })
  // The alarm exists only while a draft waits, so an idle extension is never woken.
  const run = async () => {
    try {
      const { waiting } = await outbox()
      if (waiting > 0) await browser.alarms.create(OUTBOX_ALARM, { periodInMinutes: 1 })
      else await browser.alarms.clear(OUTBOX_ALARM)
    } catch (error) {
      console.warn("outbox flush failed", error)
    }
  }
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === OUTBOX_ALARM) void run()
  })
  self.addEventListener("online", () => void run())
  browser.runtime.onStartup.addListener(() => void run())
  browser.runtime.onInstalled.addListener(() => void run())
  return run
}
