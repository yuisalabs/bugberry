import { isReplayMedia, MAX_REPLAY_DECOMPRESSED_BYTES, replayFrames, THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import { replayFrameKeyFor, replayFrameKeys, thumbnailKeyFor } from "../../storage/keys"
import type { StorageDriver } from "../../storage/types"
import { DecompressedTooLargeError, gunzipLimited } from "../trackers/debugger-errors"

export type UnpackResult = { ok: true; frames: number[] } | { ok: false; reason: string }

const NOT_READABLE = "Replay recording is not readable"

/**
 * Reads reports/<id>/media.json.gz, writes one frames/NNN.jpg per embedded frame, returns their times. The whole
 * stream is checked before the first write; a storage error part way removes the frames written so far.
 */
export async function unpackReplayFrames(
  storage: StorageDriver,
  reportId: string,
  mediaKey: string,
  maxBytes = MAX_REPLAY_DECOMPRESSED_BYTES,
): Promise<UnpackResult> {
  let media: unknown
  try {
    const blob = await storage.read(mediaKey)
    if (!blob) return { ok: false, reason: NOT_READABLE }
    media = JSON.parse(await gunzipLimited(blob, maxBytes))
  } catch (error) {
    if (error instanceof DecompressedTooLargeError) return { ok: false, reason: "Replay recording is too large" }
    return { ok: false, reason: NOT_READABLE }
  }
  if (!isReplayMedia(media)) return { ok: false, reason: NOT_READABLE }

  const frames = replayFrames(media.events)
  const written: string[] = []
  try {
    for (const [index, frame] of frames.entries()) {
      const key = replayFrameKeyFor(reportId, index)
      await storage.replace(key, new Uint8Array(Buffer.from(frame.jpeg, "base64")), THUMBNAIL_CONTENT_TYPE)
      written.push(key)
    }
  } catch (error) {
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)))
    throw error
  }
  return { ok: true, frames: frames.map((frame) => frame.atMs) }
}

/** Every object a report may own: media, debugger, thumbnail, and its frames. */
export function reportObjectKeys(row: { id: string; mediaKey: string | null; debuggerKey: string | null; replayFrames: number[] | null }): string[] {
  // The thumbnail key is always tried: one that arrived after finalize dropped it has no reference.
  return [row.mediaKey, row.debuggerKey, thumbnailKeyFor(row.id), ...replayFrameKeys(row.id, row.replayFrames?.length ?? 0)].filter(
    (key): key is string => key !== null,
  )
}
