import { isReplayMedia, MAX_REPLAY_DECOMPRESSED_BYTES, MAX_REPLAY_FRAMES, replayFrames, THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import { replayFrameKeyFor, replayFrameKeys, thumbnailKeyFor } from "../../storage/keys"
import type { StorageDriver } from "../../storage/types"
import { createSlots } from "../../lib/slots"
import { DecompressedTooLargeError, gunzipLimited } from "../trackers/debugger-errors"

export type UnpackResult = { ok: true; frames: number[] } | { ok: false; reason: string }

const NOT_READABLE = "Replay recording is not readable"
const TOO_LARGE = "Replay recording is too large"

/** Each unpack holds up to 64 MB of JSON in memory, so only this many run at once across every finalize. */
export const MAX_PARALLEL_UNPACKS = 2
const withUnpackSlot = createSlots(MAX_PARALLEL_UNPACKS)

/**
 * Reads reports/<id>/media.json.gz, writes one frames/NNN.jpg per embedded frame, returns their times. The whole
 * stream is checked before the first write; a storage error part way removes the frames written so far.
 */
export function unpackReplayFrames(
  storage: StorageDriver,
  reportId: string,
  mediaKey: string,
  maxBytes = MAX_REPLAY_DECOMPRESSED_BYTES,
  maxFrames = MAX_REPLAY_FRAMES,
): Promise<UnpackResult> {
  return withUnpackSlot(() => unpack(storage, reportId, mediaKey, maxBytes, maxFrames))
}

async function unpack(storage: StorageDriver, reportId: string, mediaKey: string, maxBytes: number, maxFrames: number): Promise<UnpackResult> {
  let media: unknown
  try {
    const blob = await storage.read(mediaKey)
    if (!blob) return { ok: false, reason: NOT_READABLE }
    media = JSON.parse(await gunzipLimited(blob, maxBytes))
  } catch (error) {
    if (error instanceof DecompressedTooLargeError) return { ok: false, reason: TOO_LARGE }
    return { ok: false, reason: NOT_READABLE }
  }
  if (!isReplayMedia(media)) return { ok: false, reason: NOT_READABLE }

  const frames = replayFrames(media.events)
  if (frames.length > maxFrames) return { ok: false, reason: TOO_LARGE }
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
