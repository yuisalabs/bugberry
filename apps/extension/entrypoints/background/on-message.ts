import { browser } from "wxt/browser"
import { handleAiTest, handleAiWrite, isAiTestRequest, isAiWriteRequest } from "../../lib/ai/ai-relay"
import { browserAiKeyStorage } from "../../lib/ai/browser-ai-key"
import type { ActiveTab, CaptureResult } from "../../lib/capture/capture-flow"
import type { ScreenshotMode } from "../../lib/capture/capture-prefs"
import { cameraTicketReply, type createCameraGrants, uiStateReply } from "../../lib/devices/camera-grant"
import { fromAutomationPage, fromExtensionPage, fromPopup, ofThisRecording } from "../../lib/platform/sender-rules"
import { type createPromptOpener, type PromptTickets, ticketFor } from "../../lib/prompts/prompt-opener"
import { browserRecordingState } from "../../lib/recording/browser-recording-state"
import type { RecordingEndReason } from "../../lib/recording/recorder"
import type { RecordingController } from "../../lib/recording/recording-controller"
import type { createWindowRecorderHost } from "../../lib/recording/recorder-window"
import type { createReviewOpener } from "../../lib/review/review-opener"
import { handleApiFetch, isApiFetchRequest } from "../../lib/server/api-relay"
import { bridgeSenderOrigin, type createBridge } from "../../lib/server/bridge"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage } from "../../lib/server/browser-settings"
import { loadSettings } from "../../lib/server/settings"
import {
  type BarRequest,
  isAutomationStopRequest,
  isBarRequest,
  isBridgeHelloRequest,
  isBridgeOpenPopupRequest,
  isBridgeUseServerRequest,
  isCameraTicketRequest,
  isOpenDraftRequest,
  isPageFlush,
  isPageStart,
  isPopupPromptRequest,
  isPopupRecordingRequest,
  isPromptTicketRequest,
  isRecorderReadyNotice,
  isRecordingEndedNotice,
  isRecordStartRequest,
  isRecordStatusRequest,
  isReviewAgainRequest,
  isReviewAnotherRequest,
  isScreenshotRequest,
  isUiStateRequest,
  type PopupRecordingAction,
  type RecordOptions,
} from "../../lib/shared/messages"
import type { createTakeAgain } from "../../lib/capture/take-again"
import { toActiveTab } from "./tabs"

/** The build bundled with the agent recorder (`bun run build:recorder`); the store builds never have its automation path. */
// Defined by wxt.config.ts as a literal, so the store builds drop the automation path altogether.
const RECORDER_BUILD = __BUGBERRY_RECORDER_BUILD__

type MessageListener = Parameters<typeof browser.runtime.onMessage.addListener>[0]

/** What the message listener closes over; everything is created before the listener is registered. */
export interface MessageListenerDeps {
  bridge: ReturnType<typeof createBridge>
  recordings: RecordingController
  windowHost: ReturnType<typeof createWindowRecorderHost> | null
  cameraGrants: ReturnType<typeof createCameraGrants>
  promptTickets: PromptTickets
  openPrompt: ReturnType<typeof createPromptOpener>
  openReview: ReturnType<typeof createReviewOpener>
  reviewUrl(draftId: string): string
  screenshot(tab: ActiveTab | null, mode?: ScreenshotMode): Promise<CaptureResult>
  record(tab: ActiveTab | null, options?: RecordOptions, caps?: { maxBytes: number; maxMs: number }): Promise<CaptureResult>
  takeAgain: ReturnType<typeof createTakeAgain>
  takeAnother(captureType: "screenshot" | "video", tabId: number, mode: ScreenshotMode): Promise<CaptureResult>
  author(): Promise<string>
  barAction(message: Exclude<BarRequest, { type: "bugberry:me-name" }>): Promise<unknown>
  popupAction(action: PopupRecordingAction): Promise<unknown>
  stopRecording(reason?: RecordingEndReason): Promise<CaptureResult>
  extensionOrigin: string
}

/** Every message the extension's pages, the page layer and the bridge send to the background, checked in this order. */
export function createMessageListener(deps: MessageListenerDeps): MessageListener {
  const { bridge, recordings, windowHost, cameraGrants, promptTickets, openPrompt, openReview, reviewUrl, screenshot, record, takeAgain, takeAnother, author, barAction, popupAction, stopRecording, extensionOrigin } = deps
  return (message, sender, sendResponse) => {
    const reply = (work: Promise<unknown>) => {
      work.then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: String(error) }))
      return true // keeps the channel open for the async response
    }
    // Firefox's review over a page gets no sign-in cookie of its own; its API requests come here.
    if (isApiFetchRequest(message)) {
      if (!fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(
        loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN).then((settings) => handleApiFetch(message, settings?.serverUrl ?? null, fetch)),
      )
    }
    // Write with AI on the reporter's own key: only the extension's pages may use it, never a web page.
    if (isAiWriteRequest(message) || isAiTestRequest(message)) {
      if (!fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(isAiWriteRequest(message) ? handleAiWrite(message, browserAiKeyStorage, fetch) : handleAiTest(message, fetch))
    }
    if (isRecorderReadyNotice(message)) {
      if (fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) windowHost?.ready()
      return undefined
    }
    if (isBridgeHelloRequest(message) || isBridgeUseServerRequest(message) || isBridgeOpenPopupRequest(message)) {
      const origin = bridgeSenderOrigin(sender, browser.runtime.id)
      if (!origin) return undefined
      if (isBridgeOpenPopupRequest(message)) return reply(bridge.openPopup(origin))
      return reply(isBridgeHelloRequest(message) ? bridge.hello(origin) : bridge.useServer(origin, sender.tab?.id ?? null))
    }
    if (isScreenshotRequest(message)) {
      return reply(browser.tabs.get(message.tabId).then((tab) => screenshot(toActiveTab(tab), message.mode ?? "visible")))
    }
    // The agent recorder's own build only, and only from its own pages: a web page or the store build never gets here.
    const fromRecorder = fromAutomationPage(sender, browser.runtime.id, extensionOrigin, RECORDER_BUILD)
    if (isRecordStartRequest(message)) {
      const caps = fromRecorder ? message.caps : undefined
      return reply(browser.tabs.get(message.tabId).then((tab) => record(toActiveTab(tab), message.options, caps)))
    }
    if (RECORDER_BUILD && isAutomationStopRequest(message)) {
      if (!fromRecorder) return undefined
      return reply(recordings.stop(undefined, { review: false }))
    }
    // The page layer asks on every page load whether its tab is being recorded.
    if (isUiStateRequest(message)) {
      return reply(
        Promise.all([browserRecordingState.get(), cameraGrants.forTab(sender.tab?.id)]).then(([state, camera]) => uiStateReply(state, camera, sender.tab?.id)),
      )
    }
    // The camera bubble, by its grant's token: only from inside the granted tab (sites can embed the page).
    if (isCameraTicketRequest(message)) {
      if (!fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(cameraTicketReply(cameraGrants, message, sender.tab?.id))
    }
    // Only the extension's own pages drive a recording: the review from anywhere, the bar and the drawing
    // layer only from inside the recorded tab (another site can embed those pages, but not in that tab).
    if (isReviewAgainRequest(message)) {
      return fromExtensionPage(sender, browser.runtime.id, extensionOrigin) ? reply(takeAgain(message.draftId)) : undefined
    }
    if (isReviewAnotherRequest(message)) {
      return fromExtensionPage(sender, browser.runtime.id, extensionOrigin)
        ? reply(takeAnother(message.captureType, message.tabId, message.mode ?? "visible"))
        : undefined
    }
    // The popup can't show the browser's microphone prompt, and a draft opened from it belongs over the page too.
    if (isPopupPromptRequest(message)) {
      return fromPopup(sender, browser.runtime.id, extensionOrigin) ? reply(openPrompt({ page: message.page }, message.tabId).then(() => ({ ok: true }))) : undefined
    }
    if (isOpenDraftRequest(message)) {
      if (!fromPopup(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(
        message.tabId === null
          ? browser.tabs.create({ url: reviewUrl(message.draftId) }).then(() => ({ ok: true }))
          : openReview(message.draftId, message.tabId).then(() => ({ ok: true })),
      )
    }
    if (isPromptTicketRequest(message)) {
      if (!fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(
        ticketFor(promptTickets, message.token, sender.tab?.id, Date.now()).then(async (ticket) => {
          if (!ticket || message.action === "read") return ticket ? { page: ticket.page, server: ticket.server ?? null } : null
          await promptTickets.delete(message.token)
          if (message.action === "tab") {
            await openPrompt({ page: ticket.page, ...(ticket.server ? { server: ticket.server } : {}) }, null)
            return { ok: true }
          }
          // Back where they asked from: the popup shows the microphone (or camera) on.
          if (ticket.page === "microphone" || ticket.page === "camera") await browser.action.openPopup().catch(() => {})
          return { ok: true }
        }),
      )
    }
    if (isBarRequest(message)) {
      if (message.type === "bugberry:me-name") return fromExtensionPage(sender, browser.runtime.id, extensionOrigin) ? reply(author()) : undefined
      return reply(
        browserRecordingState.get().then((state) =>
          ofThisRecording(sender, browser.runtime.id, extensionOrigin, state, message.session) ? barAction(message) : { ok: false, error: "Not the recorded tab" },
        ),
      )
    }
    if (isPopupRecordingRequest(message)) {
      return fromPopup(sender, browser.runtime.id, extensionOrigin) ? reply(popupAction(message.action)) : undefined
    }
    if (isRecordStatusRequest(message)) return reply(recordings.status())
    // Only the recorded tab counts; flush scripts in other tabs also see that a recording runs.
    if (isPageStart(message)) {
      if (sender.tab?.id !== undefined) void recordings.noteNavigation(sender.tab.id)
      return undefined
    }
    if (isPageFlush(message)) {
      if (sender.tab?.id !== undefined) void recordings.notePageFlush(sender.tab.id, message)
      return undefined
    }
    // The offscreen recorder stopped by itself (time limit, tab closed, error).
    if (isRecordingEndedNotice(message)) void stopRecording(message.reason)
    return undefined
  }
}
