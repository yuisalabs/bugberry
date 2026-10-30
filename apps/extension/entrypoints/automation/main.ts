import { base64Chunk, type PreparedDraft, prepareAutomationDraft } from "../../lib/drafts/automation-draft"
import { createIndexedDbDraftStore } from "../../lib/drafts/draft-store"
import { makeThumbnail } from "../../lib/review/thumbnail"
import { browserThumbnailDeps } from "../../lib/review/thumbnail-browser"

/**
 * The agent recorder's way into finished recordings, in the recorder build only: it opens this page over CDP and
 * calls these. Not web accessible, so no site can frame it.
 */
const store = createIndexedDbDraftStore()
/** The recording being read: prepared once, then read a slice at a time while this page stays open. */
let prepared: { id: string; draft: PreparedDraft } | null = null

Object.assign(globalThis, {
  bugberryAutomation: {
    prepareDraft: async (id: string) => {
      const draft = await prepareAutomationDraft(store, id, {
        makeThumbnail: (video, durationMs) => makeThumbnail(video, { captureType: "video", durationMs }, browserThumbnailDeps),
      })
      prepared = { id, draft }
      return draft.meta
    },
    readChunk: (id: string, file: "media" | "debugger" | "thumbnail", offset: number, length: number) => {
      const blob = prepared?.id === id ? prepared.draft.files[file] : null
      if (!blob) throw new Error("Prepare the recording first")
      return base64Chunk(blob, offset, length)
    },
    deleteDraft: (id: string) => store.delete(id),
  },
})
