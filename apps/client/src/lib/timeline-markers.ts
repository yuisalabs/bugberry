import type { TimelineMarker } from "@bugberry/player"
import { type DebuggerView, eventBase, isFailedRequest } from "@bugberry/debugger-view"
import { formatOffset } from "./format"

/** The address without its host, which is the same for every request on a page. */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

/**
 * What the video timeline marks: failed requests (their status, or "xhr" when the request never got
 * an answer) and errors ("err"), at their offset from the start of the recording.
 */
export function timelineMarkers(view: DebuggerView): TimelineMarker[] {
  const base = eventBase(view)
  if (base === null || view.recordingStartedAt === null) return []
  const markers: TimelineMarker[] = []
  view.events.forEach((event, index) => {
    const atMs = event.t - base
    const id = `${index}`
    if (event.kind === "network" && isFailedRequest(event)) {
      const request = `${event.method} ${shortUrl(event.url)}`
      markers.push(
        event.failed !== null
          ? { id, atMs, kind: "network", label: "xhr", detail: `${request} failed: ${event.failed}` }
          : { id, atMs, kind: "network", label: String(event.status), detail: `${request} → ${event.status}` },
      )
    } else if (event.kind === "console" && event.level === "error") {
      markers.push({ id, atMs, kind: "error", label: "err", detail: event.text })
    } else if (event.kind === "error") {
      markers.push({ id, atMs, kind: "error", label: "err", detail: event.message })
    }
  })
  // Notes and pauses are stored in video time already.
  for (const note of view.notes) {
    markers.push({ id: `note-${note.n}`, atMs: note.atMs, kind: "note", label: String(note.n), detail: note.text })
  }
  view.pauses.forEach((pause, index) => {
    const detail = `Paused at ${formatOffset(pause.atMs)} · ${Math.round(pause.ms / 1000)}s`
    markers.push({ id: `pause-${index}`, atMs: pause.atMs, kind: "pause", label: "⏸", detail })
  })
  return markers
}
