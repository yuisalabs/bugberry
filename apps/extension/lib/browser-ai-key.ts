import { browser } from "wxt/browser"
import { type AiKeyStorage, readStoredKey } from "./ai-key"

const KEY = "aiPersonalKey"

export const browserAiKeyStorage: AiKeyStorage = {
  async get() {
    return readStoredKey((await browser.storage.local.get(KEY))[KEY])
  },
  async set(value) {
    await browser.storage.local.set({ [KEY]: value })
  },
  async clear() {
    await browser.storage.local.remove(KEY)
  },
}
