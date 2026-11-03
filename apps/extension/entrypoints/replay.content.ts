import { record } from "@rrweb/record"
import { browser } from "wxt/browser"
import { installReplayRecorder } from "../lib/replay/replay-page"

/**
 * The replay recorder (isolated world). Not in the manifest: the background injects it into armed tabs only, after
 * each page load, so a second injection into the same page must not record twice.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  allFrames: false,
  main() {
    const scope = globalThis as { __bugberryReplay?: boolean }
    if (scope.__bugberryReplay) return
    scope.__bugberryReplay = true
    installReplayRecorder({
      // rrweb's own event type stays at this boundary.
      record: (options) => record(options as unknown as Parameters<typeof record>[0]),
      addCustomEvent: (tag, payload) => record.addCustomEvent(tag, payload),
      takeFullSnapshot: () => record.takeFullSnapshot(true),
      requestFrame: () =>
        browser.runtime.sendMessage({ type: "bugberry:replay-frame" }).then(
          (answer: { jpeg?: string | null } | undefined) => answer?.jpeg ?? null,
          () => null,
        ),
      visible: () => document.visibilityState === "visible",
      onMessage: (handler) => browser.runtime.onMessage.addListener((message, _sender, reply) => handler(message, reply)),
      now: Date.now,
      setInterval,
      clearInterval,
    })
  },
})
