import type { RecordSource, ScreenshotMode } from "./capture-prefs"
import type { RecordingEndReason } from "./recorder"

export interface ScreenshotRequest {
  type: "bugberry:screenshot"
  tabId: number
  /** Without it, the visible area. */
  mode?: ScreenshotMode
}

/** How to record; a request without them uses the popup's stored choices. */
export interface RecordOptions {
  source: RecordSource
  mic: boolean
  systemAudio: boolean
  countdown: boolean
}

export interface RecordStartRequest {
  type: "bugberry:record-start"
  tabId: number
  options?: RecordOptions
}


export interface RecordStatusRequest {
  type: "bugberry:record-status"
}

/** Sent by the offscreen recorder when the recording ended by itself. */
export interface RecordingEndedNotice {
  type: "bugberry:recording-ended"
  reason: RecordingEndReason
}

/** Flush script to background, as the recorded page goes away: that document's capture buffer. */
export interface PageFlushMessage {
  type: "bugberry:page-flush"
  documentId: string
  events: unknown[]
  incomplete: unknown[]
}

/** Flush script to background: a page loaded while a recording runs (counted to spot one that never flushed). */
export interface PageStartMessage {
  type: "bugberry:page-start"
}

/** What to record: a tab by its tabCapture stream id, or a screen or window the reporter picks in Chrome's dialog. */
export type CaptureSource =
  | { kind: "tab"; streamId: string }
  | { kind: "display"; surface: "monitor" | "window"; systemAudio: boolean }

/**
 * Background → offscreen document. `open` gets the stream (and Chrome's share picker) ready; `begin` starts
 * recording after the countdown. `maxBytes`: the recording ends by itself once the video reaches it.
 */
export type OffscreenMessage =
  | { type: "bugberry:offscreen-open"; draftId: string; capture: CaptureSource; mic: boolean; maxBytes: number }
  | { type: "bugberry:offscreen-begin" }
  | { type: "bugberry:offscreen-pause" }
  | { type: "bugberry:offscreen-resume" }
  | { type: "bugberry:offscreen-mic"; on: boolean }
  /** Drops the take so far and waits for `begin` again, on the same stream. */
  | { type: "bugberry:offscreen-restart" }
  /** Drops the take and the stream. */
  | { type: "bugberry:offscreen-discard" }
  | { type: "bugberry:offscreen-stop" }

const BARE_OFFSCREEN = new Set([
  "bugberry:offscreen-begin",
  "bugberry:offscreen-pause",
  "bugberry:offscreen-resume",
  "bugberry:offscreen-restart",
  "bugberry:offscreen-discard",
  "bugberry:offscreen-stop",
])

function typeOf(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null
  const type = (message as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

function field(message: unknown, name: string): unknown {
  return (message as Record<string, unknown>)[name]
}

export function isScreenshotRequest(message: unknown): message is ScreenshotRequest {
  const mode = field(message, "mode")
  return (
    typeOf(message) === "bugberry:screenshot" &&
    typeof field(message, "tabId") === "number" &&
    (mode === undefined || mode === "visible" || mode === "area")
  )
}

export function isRecordStartRequest(message: unknown): message is RecordStartRequest {
  const options = field(message, "options")
  return (
    typeOf(message) === "bugberry:record-start" &&
    typeof field(message, "tabId") === "number" &&
    (options === undefined || isRecordOptions(options))
  )
}

function isRecordOptions(value: unknown): value is RecordOptions {
  if (typeof value !== "object" || value === null) return false
  const options = value as Record<string, unknown>
  return (
    (options.source === "tab" || options.source === "screen" || options.source === "window") &&
    typeof options.mic === "boolean" &&
    typeof options.systemAudio === "boolean" &&
    typeof options.countdown === "boolean"
  )
}


export function isRecordStatusRequest(message: unknown): message is RecordStatusRequest {
  return typeOf(message) === "bugberry:record-status"
}

export function isPageFlush(message: unknown): message is PageFlushMessage {
  return (
    typeOf(message) === "bugberry:page-flush" &&
    typeof field(message, "documentId") === "string" &&
    Array.isArray(field(message, "events")) &&
    Array.isArray(field(message, "incomplete"))
  )
}

export function isPageStart(message: unknown): message is PageStartMessage {
  return typeOf(message) === "bugberry:page-start"
}

export function isRecordingEndedNotice(message: unknown): message is RecordingEndedNotice {
  return typeOf(message) === "bugberry:recording-ended"
}

export function isOffscreenMessage(message: unknown): message is OffscreenMessage {
  const type = typeOf(message)
  if (type !== null && BARE_OFFSCREEN.has(type)) return true
  if (type === "bugberry:offscreen-mic") return typeof field(message, "on") === "boolean"
  const maxBytes = field(message, "maxBytes")
  return (
    type === "bugberry:offscreen-open" &&
    typeof field(message, "draftId") === "string" &&
    isCaptureSource(field(message, "capture")) &&
    typeof field(message, "mic") === "boolean" &&
    typeof maxBytes === "number" &&
    Number.isFinite(maxBytes) &&
    maxBytes > 0
  )
}

function isCaptureSource(value: unknown): value is CaptureSource {
  if (typeof value !== "object" || value === null) return false
  const source = value as Record<string, unknown>
  if (source.kind === "tab") return typeof source.streamId === "string"
  return source.kind === "display" && (source.surface === "monitor" || source.surface === "window") && typeof source.systemAudio === "boolean"
}

/** Bridge content script → background: a page said hello, or asked to become the extension's server. */
export interface BridgeHelloRequest {
  type: "bugberry:bridge-hello"
}

export interface BridgeUseServerRequest {
  type: "bugberry:bridge-use-server"
}

export interface BridgeOpenPopupRequest {
  type: "bugberry:bridge-open-popup"
}

export function isBridgeOpenPopupRequest(message: unknown): message is BridgeOpenPopupRequest {
  return typeOf(message) === "bugberry:bridge-open-popup"
}

export function isBridgeHelloRequest(message: unknown): message is BridgeHelloRequest {
  return typeOf(message) === "bugberry:bridge-hello"
}

export function isBridgeUseServerRequest(message: unknown): message is BridgeUseServerRequest {
  return typeOf(message) === "bugberry:bridge-use-server"
}

/** Background → the page layer of a tab (recording-ui.content.ts). */
export type PageUiMessage =
  | { type: "bugberry:ui-recording"; on: boolean; session: string }
  /** Answered with "done" or "cancel". */
  | { type: "bugberry:ui-countdown" }
  /** Answered with { ok: true } once the review is shown. */
  | { type: "bugberry:ui-review"; draftId: string }
  /** Takes the review off the page, before "Retake" or "Record again" captures it. */
  | { type: "bugberry:ui-review-close" }

export function isPageUiMessage(message: unknown): message is PageUiMessage {
  const type = typeOf(message)
  if (type === "bugberry:ui-countdown" || type === "bugberry:ui-review-close") return true
  if (type === "bugberry:ui-review") return typeof field(message, "draftId") === "string"
  return type === "bugberry:ui-recording" && typeof field(message, "on") === "boolean" && typeof field(message, "session") === "string"
}

/** Page layer → background, when a page loads: is this tab being recorded? */
export interface UiStateRequest {
  type: "bugberry:ui-state"
}

export function isUiStateRequest(message: unknown): message is UiStateRequest {
  return typeOf(message) === "bugberry:ui-state"
}

/** The Recording Bar and the drawing layer → background. Stopping uses the popup's RecordStopRequest. */
/**
 * The Recording Bar and the drawing layer → background. Each names its recording (`session`, from the
 * frame's URL, which the page can't read): a page can embed these frames but can't drive the recording.
 */
export type BarRequest =
  | { type: "bugberry:bar-status"; session: string }
  | { type: "bugberry:record-pause"; session: string }
  | { type: "bugberry:record-resume"; session: string }
  | { type: "bugberry:record-mic"; on: boolean; session: string }
  | { type: "bugberry:record-restart"; session: string }
  | { type: "bugberry:record-discard"; session: string }
  | { type: "bugberry:record-note"; text: string; session: string }
  | { type: "bugberry:bar-stop"; session: string }
  /** The signed-in name, written on notes. */
  | { type: "bugberry:me-name" }

const BARE_BAR = new Set([
  "bugberry:bar-status",
  "bugberry:record-pause",
  "bugberry:record-resume",
  "bugberry:record-restart",
  "bugberry:record-discard",
  "bugberry:bar-stop",
])

export function isBarRequest(message: unknown): message is BarRequest {
  const type = typeOf(message)
  if (type === "bugberry:me-name") return true
  if (typeof field(message, "session") !== "string") return false
  if (type !== null && BARE_BAR.has(type)) return true
  if (type === "bugberry:record-mic") return typeof field(message, "on") === "boolean"
  return type === "bugberry:record-note" && typeof field(message, "text") === "string"
}

/** The review → background: delete this draft and take it again ("Record again", "Retake"). */
export interface ReviewAgainRequest {
  type: "bugberry:review-again"
  draftId: string
}

export function isReviewAgainRequest(message: unknown): message is ReviewAgainRequest {
  return typeOf(message) === "bugberry:review-again" && typeof field(message, "draftId") === "string"
}
