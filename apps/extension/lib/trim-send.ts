import type { DebuggerPayload } from "@bugberry/capture"
import type { DraftStore } from "./draft-store"
import { isTrimmed, trimPayload } from "./review-data"
import { draftWithTrim, sameRange } from "./review-draft"
import type { trimVideo } from "./trim-video"
import type { VideoDraft } from "./types"

/** What a recording's send uploads: the (trimmed) video, its payload and its length. */
export interface PreparedMedia {
  media: Blob
  payload: DebuggerPayload | null
  durationMs: number | null
}

/**
 * The media of a video draft as it will be sent. A trimmed draft is encoded once and the result saved with its
 * range, so a retry uploads the same bytes (and can go on with an upload in parts) instead of encoding again.
 */
export async function prepareVideo(
  draft: VideoDraft,
  deps: { store: Pick<DraftStore, "get" | "put">; trimVideo: typeof trimVideo },
  onProgress?: (fraction: number) => void,
  options: { fullVideo?: boolean } = {},
): Promise<PreparedMedia> {
  if (!draft.video) throw new Error("The report's media isn't available")
  if (options.fullVideo) {
    // The reporter chose the full video: the trim goes, with the video and payload encoding made for it, so a
    // later "Try again" (which passes no option) sends the full video and logs as well.
    const latest = await deps.store.get(draft.id)
    if (latest) await deps.store.put(draftWithTrim(latest, null))
    return { media: draft.video, payload: draft.debuggerPayload, durationMs: draft.durationMs }
  }
  const range = draft.trim
  if (!isTrimmed(range, draft.durationMs ?? 0)) {
    return { media: draft.video, payload: draft.debuggerPayload, durationMs: draft.durationMs }
  }

  let media = draft.trimmed && sameRange(draft.trimmed.range, range) ? draft.trimmed.video : null
  if (!media) {
    media = await deps.trimVideo(draft.video, range, onProgress)
    const latest = await deps.store.get(draft.id)
    if (latest?.captureType === "video") await deps.store.put({ ...latest, trimmed: { range, video: media } })
  }
  const startedAt = draft.recordingStartedAt ?? draft.debuggerPayload?.recordingStartedAt ?? 0
  return {
    media,
    payload: draft.debuggerPayload && trimPayload(draft.debuggerPayload, startedAt, range),
    durationMs: range.endMs - range.startMs,
  }
}
