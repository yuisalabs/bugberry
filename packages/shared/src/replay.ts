import { MEDIA_TYPES } from "./constants"

/** How far back an armed tab can capture; the buffer holds between one and two windows. */
export const REPLAY_WINDOWS_MS = [30_000, 60_000, 120_000] as const
export type ReplayWindowMs = (typeof REPLAY_WINDOWS_MS)[number]
export const REPLAY_FRAME_INTERVAL_MS = 5_000
/** JPEG quality from 0 to 100, as captureVisibleTab takes it. */
export const REPLAY_FRAME_QUALITY = 60
export const REPLAY_BUFFER_MAX_BYTES = 30 * 1024 * 1024
export const MAX_REPLAY_DECOMPRESSED_BYTES = 64 * 1024 * 1024
/** The rrweb custom event tag of a screenshot embedded in the stream. */
export const REPLAY_FRAME_TAG = "bugberry:frame"
export const REPLAY_MEDIA_VERSION = 1

const RRWEB_CUSTOM_EVENT = 5

/** The slice of an rrweb event the server and the players need; the rest is opaque. */
export interface ReplayEvent {
  type: number
  timestamp: number
  data: unknown
}

export interface ReplayMedia {
  version: 1
  events: ReplayEvent[]
}

/** A screenshot from the stream: `atMs` from the replay's start, `jpeg` in base64. */
export interface ReplayFrame {
  atMs: number
  jpeg: string
}

function isReplayEvent(value: unknown): value is ReplayEvent {
  if (typeof value !== "object" || value === null) return false
  const event = value as { type?: unknown; timestamp?: unknown }
  return typeof event.type === "number" && typeof event.timestamp === "number"
}

export function isReplayMedia(value: unknown): value is ReplayMedia {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const media = value as { version?: unknown; events?: unknown }
  return (
    media.version === REPLAY_MEDIA_VERSION &&
    Array.isArray(media.events) &&
    media.events.length > 0 &&
    media.events.every(isReplayEvent)
  )
}

/** The first event is rrweb's Meta event of the kept segment; every time in a replay counts from it. */
export function replayStartedAt(events: ReplayEvent[]): number {
  return events[0]?.timestamp ?? 0
}

export function replayDurationMs(events: ReplayEvent[]): number {
  if (events.length === 0) return 0
  return events[events.length - 1]!.timestamp - replayStartedAt(events)
}

function frameJpeg(event: ReplayEvent): string | null {
  if (event.type !== RRWEB_CUSTOM_EVENT || typeof event.data !== "object" || event.data === null) return null
  const data = event.data as { tag?: unknown; payload?: { jpeg?: unknown } }
  if (data.tag !== REPLAY_FRAME_TAG) return null
  return typeof data.payload?.jpeg === "string" ? data.payload.jpeg : null
}

export function replayFrames(events: ReplayEvent[]): ReplayFrame[] {
  const start = replayStartedAt(events)
  const frames: ReplayFrame[] = []
  for (const event of events) {
    const jpeg = frameJpeg(event)
    if (jpeg !== null) frames.push({ atMs: event.timestamp - start, jpeg })
  }
  return frames
}

/** The frame showing the page at `atMs`: the last one taken at or before it, never one after. */
export function frameIndexAt<T extends { atMs: number }>(frames: readonly T[], atMs: number): number | null {
  let found: number | null = null
  for (const [index, frame] of frames.entries()) {
    if (frame.atMs > atMs) break
    found = index
  }
  return found
}

export async function encodeReplayMedia(media: ReplayMedia): Promise<Blob> {
  const compressed = new Blob([JSON.stringify(media)]).stream().pipeThrough(new CompressionStream("gzip"))
  return new Blob([await new Response(compressed).arrayBuffer()], { type: MEDIA_TYPES.replay })
}

export async function decodeReplayMedia(blob: Blob): Promise<ReplayMedia> {
  const text = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()
  const parsed: unknown = JSON.parse(text)
  if (!isReplayMedia(parsed)) throw new Error("Unsupported replay media")
  return parsed
}
