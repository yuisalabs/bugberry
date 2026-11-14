import { MAX_REPLAY_DECOMPRESSED_BYTES, MAX_REPLAY_FRAMES, THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import { replayFrameKeyFor, replayFrameKeys, thumbnailKeyFor } from "../../storage/keys"
import type { StorageDriver } from "../../storage/types"
import { createSlots } from "../../lib/slots"
import { PayloadError, parseReplayFrames } from "../../workers/payloads"

export type UnpackResult = { ok: true; frames: number[] } | { ok: false; reason: string }

const NOT_READABLE = "Replay recording is not readable"
const TOO_LARGE = "Replay recording is too large"

/** Each unpack holds up to 64 MB of JSON in memory (on a worker thread), so only this many run at once across every finalize. */
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
  let frames: Array<{ atMs: number; jpeg: Uint8Array<ArrayBuffer> }>
  try {
    const blob = await storage.read(mediaKey)
    if (!blob) return { ok: false, reason: NOT_READABLE }
    // Unpacked, parsed and decoded on a worker thread, so a large replay never stalls other requests.
    frames = await parseReplayFrames(blob, { maxBytes, maxFrames })
  } catch (error) {
    if (error instanceof PayloadError && error.reason === "too_large") return { ok: false, reason: TOO_LARGE }
    return { ok: false, reason: NOT_READABLE }
  }

  const written: string[] = []
  try {
    for (const [index, frame] of frames.entries()) {
      const key = replayFrameKeyFor(reportId, index)
      await storage.replace(key, frame.jpeg, THUMBNAIL_CONTENT_TYPE)
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
