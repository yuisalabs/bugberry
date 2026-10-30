import { browser } from "wxt/browser"
import { createIndexedDbDraftStore } from "../../lib/drafts/draft-store"
import { isOffscreenMessage, type RecordingEndedNotice } from "../../lib/shared/messages"
import { createMediaDeps, createRecorderHandler } from "../../lib/recording/recorder-handler"

/** Offscreen document: the only extension context that may call getUserMedia for a tab stream in Chrome's MV3. */
const recorder = createRecorderHandler({
  store: createIndexedDbDraftStore(),
  ...createMediaDeps(),
  noticeEnded: (reason) => {
    const notice: RecordingEndedNotice = { type: "bugberry:recording-ended", reason }
    // Nobody may be listening (the background restarted); that must not become an unhandled rejection.
    browser.runtime.sendMessage(notice).catch(() => {})
  },
})

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isOffscreenMessage(message)) return undefined
  recorder.handle(message).then(sendResponse, (error: unknown) =>
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
  return true // keeps the channel open for the async response
})
