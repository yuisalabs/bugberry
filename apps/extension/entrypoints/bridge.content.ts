import { browser } from "wxt/browser"
import { installPageBridge } from "../lib/server/bridge"

/**
 * Lets a BugBerry dashboard ask whether the extension sends to it, and ask to become its server.
 * The background decides whether the page is a BugBerry server; other pages never get an answer.
 * A bridge added to the page again (after an extension update) stops this one, so a request never goes out twice.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: false,
  main(ctx) {
    const stop = installPageBridge({
      window,
      origin: location.origin,
      userActive: () => navigator.userActivation?.isActive ?? false,
      alive: () => browser.runtime?.id !== undefined,
      send: (message) => browser.runtime.sendMessage(message),
    })
    ctx.onInvalidated(stop)
  },
})
