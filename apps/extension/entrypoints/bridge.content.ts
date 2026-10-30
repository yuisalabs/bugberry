import { BRIDGE_POPUP, BRIDGE_STATUS } from "@bugberry/shared"
import { browser } from "wxt/browser"
import { pageRequest } from "../lib/server/bridge"
import type { BridgeHelloRequest, BridgeOpenPopupRequest, BridgeUseServerRequest } from "../lib/shared/messages"

/**
 * Lets a BugBerry dashboard ask whether the extension sends to it, and ask to become its server.
 * The background decides whether the page is a BugBerry server; other pages never get an answer.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: false,
  main() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin) return
      const request = pageRequest(event.data, navigator.userActivation?.isActive ?? false)
      if (request === "hello") {
        const hello: BridgeHelloRequest = { type: "bugberry:bridge-hello" }
        browser.runtime
          .sendMessage(hello)
          .then((reply: unknown) => {
            const { active, version } = (reply ?? {}) as { active?: unknown; version?: unknown }
            if (typeof active !== "boolean") return
            const status = { type: BRIDGE_STATUS, active, version: typeof version === "string" ? version : null }
            window.postMessage(status, location.origin)
          })
          .catch(() => {})
      } else if (request === "open-popup") {
        const open: BridgeOpenPopupRequest = { type: "bugberry:bridge-open-popup" }
        const answer = (opened: boolean) => window.postMessage({ type: BRIDGE_POPUP, opened }, location.origin)
        browser.runtime
          .sendMessage(open)
          .then((reply: unknown) => answer(reply === true))
          .catch(() => answer(false))
      } else if (request === "use-server") {
        const request: BridgeUseServerRequest = { type: "bugberry:bridge-use-server" }
        browser.runtime.sendMessage(request).catch(() => {})
      }
    })
  },
})
