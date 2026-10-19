import { browser } from "wxt/browser"
import { isPageUiMessage, type UiStateRequest } from "../lib/messages"
import { type BarPosition, createPageUi, uiStateNeeded } from "../lib/page-ui"

const POSITION_KEY = "barPosition"

function positionFrom(value: unknown): BarPosition | null {
  const position = value as Partial<BarPosition> | undefined
  return typeof position?.x === "number" && typeof position.y === "number" ? { x: position.x, y: position.y } : null
}

/**
 * The page layer (isolated world): the countdown, the Recording Bar and the drawing layer on the recorded
 * tab, and the review modal after a capture. On load it asks whether this tab is being recorded, so the bar
 * comes back after a reload or a navigation.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: false,
  async main() {
    const extensionRoot = browser.runtime.getURL("/")
    const stored = (await browser.storage.local.get(POSITION_KEY).catch(() => ({}))) as Record<string, unknown>
    let position = positionFrom(stored[POSITION_KEY])
    const ui = createPageUi(document, window, {
      extensionUrl: (path) => `${extensionRoot}${path}`,
      extensionOrigin: new URL(extensionRoot).origin,
      savePosition: (next) => {
        position = next
        void browser.storage.local.set({ [POSITION_KEY]: next }).catch(() => {})
      },
      loadPosition: () => position,
    })

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isPageUiMessage(message)) return undefined
      if (message.type === "bugberry:ui-recording") {
        if (message.on) ui.showRecording(message.session)
        else ui.hideRecording()
        sendResponse({ ok: true })
        return undefined
      }
      if (message.type === "bugberry:ui-review-close") {
        ui.hideReview()
        sendResponse({ ok: true })
        return undefined
      }
      if (message.type === "bugberry:ui-review") {
        ui.showReview(message.draftId)
        sendResponse({ ok: true })
        return undefined
      }
      void ui.countdown().then(sendResponse)
      return true // answered when the countdown ends
    })

    const session = (await browser.storage.session.get("recording").catch(() => ({}))) as Record<string, unknown>
    if (!uiStateNeeded(session)) return
    const ask: UiStateRequest = { type: "bugberry:ui-state" }
    const state = (await browser.runtime.sendMessage(ask).catch(() => null)) as { recording?: unknown; session?: unknown } | null
    if (state?.recording === true && typeof state.session === "string") ui.showRecording(state.session)
  },
})
