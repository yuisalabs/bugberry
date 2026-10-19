import { type CaptureEvent, type NetworkEvent, type RecordingPause, summarize } from "@bugberry/capture"
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

/** The video's markers, by the dashboard's rules (apps/client/src/lib/timeline-markers.ts) on raw events. */
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
