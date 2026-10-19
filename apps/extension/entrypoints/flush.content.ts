import { browser } from "wxt/browser"
import { installPageFlush } from "../lib/page-flush"

/** The recording state the background keeps in session storage (lib/browser-recording-state.ts). */
const RECORDING_KEY = "recording"
const isPaused = (state: unknown) => typeof (state as { pausedAt?: unknown } | undefined)?.pausedAt === "number"

/** Hands a page's events to the background as it goes away during a recording (isolated world). */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: false,
  main() {
    installPageFlush(
      { document, window },
      (message) => void browser.runtime.sendMessage(message).catch(() => {}),
      (onChange) => {
        void browser.storage.session
          .get(RECORDING_KEY)
          .then((stored) => onChange(Boolean(stored[RECORDING_KEY]), true, isPaused(stored[RECORDING_KEY])))
          .catch(() => {})
        browser.storage.onChanged.addListener((changes, area) => {
          if (area === "session" && RECORDING_KEY in changes) {
            const value = changes[RECORDING_KEY]?.newValue
            onChange(Boolean(value), false, isPaused(value))
          }
        })
      },
    )
  },
})
