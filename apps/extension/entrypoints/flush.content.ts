import { browser } from "wxt/browser"
import { installPageFlush } from "../lib/recording/page-flush"
import { watchRecording } from "../lib/recording/recording-watch"

/** Hands a page's events to the background as it goes away during a recording (isolated world). */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: false,
  main() {
    installPageFlush(
      { document, window },
      (message) => void browser.runtime.sendMessage(message).catch(() => {}),
      (onChange) => watchRecording(browser.storage.session, browser.storage.onChanged, onChange),
    )
  },
})
