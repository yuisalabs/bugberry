import "../../assets/style.css"
import { createRoot } from "react-dom/client"
import { browser } from "wxt/browser"
import { createIndexedDbDraftStore } from "../../lib/drafts/draft-store"
import type { RecordingEndedNotice } from "../../lib/messages"
import { createMediaDeps, createRecorderHandler } from "../../lib/recording/recorder-handler"
import { App } from "./App"

/** Firefox's recorder: the same handler as Chrome's offscreen document, in a window the reporter can see. */
const recorder = createRecorderHandler({
  store: createIndexedDbDraftStore(),
  ...createMediaDeps(),
  noticeEnded: (reason) => {
    const notice: RecordingEndedNotice = { type: "bugberry:recording-ended", reason }
    browser.runtime.sendMessage(notice).catch(() => {})
  },
})

const root = document.getElementById("root")
if (root) createRoot(root).render(<App handle={recorder.handle} />)
