import { browser } from "wxt/browser"
import { type RecordingStateStore, recordingStateFrom } from "./recording-flow"

const KEY = "recording"

export const browserRecordingState: RecordingStateStore = {
  async get() {
    return recordingStateFrom((await browser.storage.session.get(KEY))[KEY])
  },
  async set(state) {
    await browser.storage.session.set({ [KEY]: state })
  },
  async clear() {
    await browser.storage.session.remove(KEY)
  },
}
