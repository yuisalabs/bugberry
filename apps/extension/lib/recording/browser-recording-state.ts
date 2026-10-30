import { browser } from "wxt/browser"
import { recordingStateFrom, type RecordingStateStore } from "./recording-state"

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
