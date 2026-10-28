import { readAutomationDraft } from "../../lib/automation-draft"
import { createIndexedDbDraftStore } from "../../lib/draft-store"
import { makeThumbnail } from "../../lib/thumbnail"
import { browserThumbnailDeps } from "../../lib/thumbnail-browser"

/**
 * The agent recorder's way into finished recordings, in the recorder build only: it opens this page over CDP and
 * calls these. Not web accessible, so no site can frame it.
 */
const store = createIndexedDbDraftStore()

Object.assign(globalThis, {
  bugberryAutomation: {
    readDraft: (id: string) =>
      readAutomationDraft(store, id, {
        makeThumbnail: (video, durationMs) => makeThumbnail(video, { captureType: "video", durationMs }, browserThumbnailDeps),
      }),
    deleteDraft: (id: string) => store.delete(id),
  },
})
