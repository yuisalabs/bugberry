import { REPLAY_FRAME_QUALITY } from "@bugberry/shared"
import { browser } from "wxt/browser"
import { createArmedStore } from "./armed-state"
import { createReplayBadge } from "./replay-badge"
import type { ReplayControllerDeps } from "./replay-controller"

/** Built by WXT from entrypoints/replay.content.ts; not in the manifest, so nothing loads it but `inject`. */
const REPLAY_SCRIPT = "/content-scripts/replay.js"

/** The controller's browser side; what needs the rest of the background (capture, limits, recording) is passed in. */
export function createBrowserReplayDeps(deps: Pick<ReplayControllerDeps, "capture" | "maxMs" | "isRecording">): ReplayControllerDeps {
  return {
    armed: createArmedStore(browser.storage.session),
    inject: async (tabId) => {
      await browser.scripting.executeScript({ target: { tabId }, files: [REPLAY_SCRIPT] })
    },
    toPage: (tabId, message) => browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
    captureJpeg: async (windowId) => {
      const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: REPLAY_FRAME_QUALITY })
      return dataUrl.slice(dataUrl.indexOf(",") + 1)
    },
    isShowing: async (tabId) => (await browser.tabs.get(tabId)).active === true,
    badge: createReplayBadge({
      // null is the documented way to give a tab back to the global badge; WXT's types only allow strings.
      setBadgeText: (details) => browser.action.setBadgeText(details as { tabId: number; text: string }),
      setBadgeBackgroundColor: (details) => browser.action.setBadgeBackgroundColor(details),
    }),
    now: Date.now,
    ...deps,
  }
}
