import { DEBUGGER_CONTENT_TYPE } from "@bugberry/shared"
import type { CaptureEvent } from "./events"
import type { CaptureSession } from "./session"

export const DEBUGGER_PAYLOAD_VERSION = 1

/** Where the report was made. Every field is optional: older extensions send none of them. */
export interface CaptureEnvironment {
  language?: string
  timeZone?: string
  pixelRatio?: number
  connection?: { effectiveType?: string; downlinkMbps?: number; rttMs?: number }
  /** "Chrome 131.0.6778.86" */
  browserVersion?: string
  /** "macOS 15.2", "Windows 11" */
  osVersion?: string
}

/** A numbered note the reporter pinned on the page while recording; `atMs` is its time in the video. */
export interface RecordingNote {
  n: number
  atMs: number
  text: string
  author: string
}

/** Where the reporter paused the recording (video time) and for how long; nothing was recorded meanwhile. */
export interface RecordingPause {
  atMs: number
  ms: number
}

/** Contents of `debugger.json.gz`, uploaded next to the screenshot or video. */
export interface DebuggerPayload {
  version: typeof DEBUGGER_PAYLOAD_VERSION
  capturedAt: number
  /** Epoch ms when video recording started, so the dashboard can align events with the video. */
  recordingStartedAt: number | null
  incomplete: string[]
  events: CaptureEvent[]
  /** Added within version 1: older dashboards ignore it. */
  environment?: CaptureEnvironment
  /** Added within version 1, recordings only. */
  notes?: RecordingNote[]
  pauses?: RecordingPause[]
}

export function buildDebuggerPayload(
  session: CaptureSession,
  options: { recordingStartedAt?: number | null; now?: () => number } = {},
): DebuggerPayload {
  return {
    version: DEBUGGER_PAYLOAD_VERSION,
    capturedAt: (options.now ?? Date.now)(),
    recordingStartedAt: options.recordingStartedAt ?? null,
    incomplete: [...session.incomplete],
    events: session.snapshot(),
  }
}

export async function encodeDebuggerPayload(payload: DebuggerPayload): Promise<Blob> {
  const compressed = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("gzip"))
  return new Blob([await new Response(compressed).arrayBuffer()], { type: DEBUGGER_CONTENT_TYPE })
}

export async function decodeDebuggerPayload(blob: Blob): Promise<DebuggerPayload> {
  const text = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()
  const parsed = JSON.parse(text) as Partial<DebuggerPayload>
  if (parsed.version !== DEBUGGER_PAYLOAD_VERSION || !Array.isArray(parsed.events)) {
    throw new Error("Unsupported debugger payload")
  }
  return parsed as DebuggerPayload
}
