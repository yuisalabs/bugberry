import { type CaptureEvent, type DebuggerPayload, type NetworkEvent, type RecordingPause, summarize } from "@bugberry/capture"
import type { TimelineMarker } from "@bugberry/player"

/** A pause in epoch ms; `end` is when the recording resumed (Infinity while it is still paused). */
export interface PauseSpan {
  start: number
  end: number
}

const TITLE_MAX = 200

const pausedAt = (t: number, pauses: readonly PauseSpan[]) => pauses.some((pause) => t >= pause.start && t < pause.end)

/** Milliseconds of video recorded before the moment `at`: the time since the start minus the paused time. */
export function videoTime(at: number, startedAt: number, pauses: readonly PauseSpan[]): number {
  const paused = pauses.reduce((total, pause) => total + Math.max(0, Math.min(at, pause.end) - Math.max(startedAt, pause.start)), 0)
  return Math.max(0, at - startedAt - paused)
}

/**
 * The events the video shows: nothing from before the start (an earlier take) or from inside a pause, and
 * each later event moved back by the paused time before it, so `t - startedAt` is its time in the video.
 */
export function applyPauses(events: readonly CaptureEvent[], startedAt: number, pauses: readonly PauseSpan[]): CaptureEvent[] {
  return events
    .filter((event) => event.t >= startedAt && !pausedAt(event.t, pauses))
    .map((event) => ({ ...event, t: startedAt + videoTime(event.t, startedAt, pauses) }))
}

/** Only the events of this take outside its pauses, still at their page time (shifted later, at stop). */
export function keptEvents<T extends { t: number }>(events: readonly T[], startedAt: number, pauses: readonly PauseSpan[]): T[] {
  return events.filter((event) => event.t >= startedAt && !pausedAt(event.t, pauses))
}

/** The dashboard's pause marks: where each pause sits in the video and how long it lasted. */
export function pauseMarks(startedAt: number, pauses: readonly PauseSpan[]): RecordingPause[] {
  return pauses.map((pause) => ({ atMs: videoTime(pause.start, startedAt, pauses), ms: Math.max(0, pause.end - pause.start) }))
}

/** The part of a recording the reporter keeps, in video time. */
export interface TrimRange {
  startMs: number
  endMs: number
}

/** The shortest part a recording can be trimmed to. */
export const MIN_TRIM_MS = 1000

/** The range in whole ms inside the video, at least MIN_TRIM_MS long (moving the end, or the start at the video's end). */
export function clampTrim(range: TrimRange, durationMs: number): TrimRange {
  const endMs = Math.min(durationMs, Math.max(0, Math.round(range.endMs)))
  const startMs = Math.min(endMs, Math.max(0, Math.round(range.startMs)))
  if (endMs - startMs >= MIN_TRIM_MS) return { startMs, endMs }
  if (startMs + MIN_TRIM_MS <= durationMs) return { startMs, endMs: startMs + MIN_TRIM_MS }
  return { startMs: Math.max(0, durationMs - MIN_TRIM_MS), endMs: durationMs }
}

/** Whether the range leaves anything out; none, or the whole video, is no trim. */
export function isTrimmed(range: TrimRange | null | undefined, durationMs: number): range is TrimRange {
  return range != null && (range.startMs > 0 || range.endMs < durationMs)
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** "0:06–0:35", as the Trim button shows it. */
export function trimLabel(range: TrimRange): string {
  return `${clock(range.startMs)}–${clock(range.endMs)}`
}

/**
 * The payload of only the kept range. Events keep their page time and the recording's start moves forward by
 * `startMs`, so `t - recordingStartedAt` is still their time in the (shorter) video; notes and pauses move back.
 */
export function trimPayload(payload: DebuggerPayload, startedAt: number, range: TrimRange): DebuggerPayload {
  const inside = (atMs: number) => atMs >= range.startMs && atMs <= range.endMs
  const shift = <T extends { atMs: number }>(items: readonly T[]) =>
    items.filter((item) => inside(item.atMs)).map((item) => ({ ...item, atMs: item.atMs - range.startMs }))
  const { notes, pauses, ...rest } = payload
  return {
    ...rest,
    recordingStartedAt: startedAt + range.startMs,
    events: payload.events.filter((event) => inside(event.t - startedAt)),
    ...(notes ? { notes: shift(notes) } : {}),
    ...(pauses ? { pauses: shift(pauses) } : {}),
  }
}

const isFailed = (event: CaptureEvent): event is NetworkEvent =>
  event.kind === "network" && (Boolean(event.failed) || (event.status ?? 0) >= 400)

const isError = (event: CaptureEvent) => event.kind === "error" || (event.kind === "console" && event.level === "error")

function path(url: string, withQuery: boolean): string {
  try {
    const parsed = new URL(url)
    return withQuery ? `${parsed.pathname}${parsed.search}` : parsed.pathname
  } catch {
    return url
  }
}

const errorText = (event: CaptureEvent) =>
  event.kind === "error" ? event.message : event.kind === "console" ? event.args.join(" ") : ""

/** The title the review suggests: the first failed request, else the first error, else none. */
export function suggestTitle(events: readonly CaptureEvent[]): { title: string; from: "request" | "console" } | null {
  const byTime = [...events].sort((a, b) => a.t - b.t)
  const request = byTime.find(isFailed)
  if (request) {
    const outcome = request.status && request.status >= 400 ? String(request.status) : "network error"
    return { title: `${request.method.toUpperCase()} ${path(request.url, false)} failed (${outcome})`.slice(0, TITLE_MAX), from: "request" }
  }
  const error = byTime.find(isError)
  const text = error ? errorText(error).trim() : ""
  return text ? { title: text.slice(0, TITLE_MAX), from: "console" } : null
}

/** The review's tiles: errors, failed requests and the reporter's steps. */
export function reviewStats(events: readonly CaptureEvent[]): { errors: number; failed: number; steps: number } {
  const summary = summarize(events, [])
  return { errors: summary.errors, failed: summary.failedRequests, steps: summary.actions }
}

/** The video's markers, by the dashboard's rules (apps/client/src/features/reports/detail/timeline-markers.ts) on raw events. */
export function reviewMarkers(events: readonly CaptureEvent[], startedAt: number): TimelineMarker[] {
  const markers: TimelineMarker[] = []
  ;[...events]
    .sort((a, b) => a.t - b.t)
    .forEach((event, index) => {
      const id = `${index}`
      const atMs = event.t - startedAt
      if (isFailed(event)) {
        const request = `${event.method.toUpperCase()} ${path(event.url, true)}`
        markers.push(
          event.failed
            ? { id, atMs, kind: "network", label: "xhr", detail: `${request} failed: ${event.failed}` }
            : { id, atMs, kind: "network", label: String(event.status), detail: `${request} → ${event.status}` },
        )
      } else if (isError(event)) {
        markers.push({ id, atMs, kind: "error", label: "err", detail: errorText(event) })
      }
    })
  return markers
}

/** The bar's live count: errors and failed requests since the start, leaving out paused moments. */
export function errorsCaught(events: readonly CaptureEvent[], since: number, pauses: readonly PauseSpan[]): number {
  return events.filter((event) => event.t >= since && !pausedAt(event.t, pauses) && (isFailed(event) || isError(event))).length
}

export interface LiveCounts {
  errors: number
  failedRequests: number
  actions: number
}

/** The popup's live counts, each on its own: since the start, leaving out paused moments. */
export function liveCounts(events: readonly CaptureEvent[], since: number, pauses: readonly PauseSpan[]): LiveCounts {
  const kept = keptEvents(events, since, pauses)
  return {
    errors: kept.filter(isError).length,
    failedRequests: kept.filter(isFailed).length,
    actions: kept.filter((event) => event.kind === "action").length,
  }
}
