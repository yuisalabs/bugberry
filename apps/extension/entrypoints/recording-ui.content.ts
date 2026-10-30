import { browser } from "wxt/browser"
import { isPageUiMessage, type UiStateRequest } from "../lib/messages"
import { type BarPosition, cameraFromUiState, cameraHeightFrom, createPageUi, uiStateNeeded } from "../lib/recording/page-ui"

const POSITION_KEY = "barPosition"
const CAMERA_POSITION_KEY = "cameraPosition"
const CAMERA_HEIGHT_KEY = "cameraHeight"

function positionFrom(value: unknown): BarPosition | null {
  const position = value as Partial<BarPosition> | undefined
  return typeof position?.x === "number" && typeof position.y === "number" ? { x: position.x, y: position.y } : null
}

/**
 * The page layer (isolated world): the countdown, the Recording Bar, the camera bubble and the drawing layer on the recorded
 * tab, the review modal after a capture, and prompts (allow the microphone, switch servers). On load it asks whether this tab is being recorded, so the bar
 * comes back after a reload or a navigation.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: false,
  async main() {
    const extensionRoot = browser.runtime.getURL("/")
    const stored = (await browser.storage.local.get([POSITION_KEY, CAMERA_POSITION_KEY, CAMERA_HEIGHT_KEY]).catch(() => ({}))) as Record<string, unknown>
    let position = positionFrom(stored[POSITION_KEY])
    let cameraPosition = positionFrom(stored[CAMERA_POSITION_KEY])
    let cameraHeight = cameraHeightFrom(stored[CAMERA_HEIGHT_KEY])
    const ui = createPageUi(document, window, {
      extensionUrl: (path) => `${extensionRoot}${path}`,
      extensionOrigin: new URL(extensionRoot).origin,
      savePosition: (next) => {
        position = next
        void browser.storage.local.set({ [POSITION_KEY]: next }).catch(() => {})
      },
      loadPosition: () => position,
      saveCameraPosition: (next) => {
        cameraPosition = next
        void browser.storage.local.set({ [CAMERA_POSITION_KEY]: next }).catch(() => {})
      },
      loadCameraPosition: () => cameraPosition,
      saveCameraHeight: (next) => {
        cameraHeight = next
        void browser.storage.local.set({ [CAMERA_HEIGHT_KEY]: next }).catch(() => {})
      },
      loadCameraHeight: () => cameraHeight,
    })

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isPageUiMessage(message)) return undefined
      if (message.type === "bugberry:ui-recording") {
        if (message.on) ui.showRecording(message.session)
        else ui.hideRecording()
        sendResponse({ ok: true })
        return undefined
      }
      if (message.type === "bugberry:ui-camera") {
        if (message.on) ui.showCamera(message.token, message.shape)
        else ui.hideCamera()
        sendResponse({ ok: true })
        return undefined
      }
      if (message.type === "bugberry:ui-review-close") {
        ui.hideReview()
        sendResponse({ ok: true })
        return undefined
      }
      if (message.type === "bugberry:ui-prompt") {
        ui.showPrompt(message.page, message.token)
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

    const session = (await browser.storage.session.get(["recording", "camera"]).catch(() => ({}))) as Record<string, unknown>
    if (!uiStateNeeded(session)) return
    const ask: UiStateRequest = { type: "bugberry:ui-state" }
    const state = (await browser.runtime.sendMessage(ask).catch(() => null)) as { recording?: unknown; session?: unknown } | null
    if (state?.recording === true && typeof state.session === "string") ui.showRecording(state.session)
    // The camera comes back on its own: it is already on during the countdown, before the recording state exists.
    const camera = cameraFromUiState(state)
    if (camera) ui.showCamera(camera.token, camera.shape)
  },
})
