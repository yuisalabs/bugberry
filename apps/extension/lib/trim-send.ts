import type { DebuggerPayload } from "@bugberry/capture"
import type { DraftStore } from "./draft-store"
import { isTrimmed, trimPayload } from "./review-data"
import { draftWithTrim, sameRange } from "./review-draft"
import type { trimVideo } from "./trim-video"
import type { ReportDraft, VideoDraft } from "./types"

/** What a recording's send uploads: the (trimmed) video, its payload and its length. */
export interface PreparedMedia {
  media: Blob
  payload: DebuggerPayload | null
  durationMs: number | null
}

/**
 * The media of a video draft as it will be sent. A trimmed draft is encoded once and the result saved with its
 * range, so a retry uploads the same bytes (and can go on with an upload in parts) instead of encoding again.
 * Once the media is ready the draft is marked as sending, which locks its trim; a failed encode leaves it open.
 */
export async function prepareVideo(
  draft: VideoDraft,
  deps: { store: Pick<DraftStore, "get" | "put">; trimVideo: typeof trimVideo },
  onProgress?: (fraction: number) => void,
  options: { fullVideo?: boolean } = {},
): Promise<PreparedMedia> {
  if (!draft.video) throw new Error("The report's media isn't available")
  /** Saves `change` on the draft as stored now (notes may have been saved meanwhile), marked as sending. */
  const markSending = async (change: (latest: VideoDraft) => ReportDraft) => {
    const latest = await deps.store.get(draft.id)
    if (latest?.captureType === "video") await deps.store.put({ ...change(latest), sendStarted: true } as ReportDraft)
  }
  const whole = { media: draft.video, payload: draft.debuggerPayload, durationMs: draft.durationMs }
  if (options.fullVideo) {
    // The reporter chose the full video: the trim goes, with the video and payload encoding made for it, so a
    // later "Try again" (which passes no option) sends the full video and logs as well.
    await markSending((latest) => draftWithTrim(latest, null))
    return whole
  }
  const range = draft.trim
  if (!isTrimmed(range, draft.durationMs ?? 0)) {
    await markSending((latest) => latest)
    return whole
  }

  let media = draft.trimmed && sameRange(draft.trimmed.range, range) ? draft.trimmed.video : null
  if (!media) {
    const made = await deps.trimVideo(draft.video, range, onProgress)
    media = made
    await markSending((latest) => ({ ...latest, trimmed: { range, video: made } }))
  } else {
    await markSending((latest) => latest)
  }
  const startedAt = draft.recordingStartedAt ?? draft.debuggerPayload?.recordingStartedAt ?? 0
  return {
    media,
    payload: draft.debuggerPayload && trimPayload(draft.debuggerPayload, startedAt, range),
    durationMs: range.endMs - range.startMs,
  }
}
