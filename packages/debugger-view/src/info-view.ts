import { isMaskedValue } from "./action-view"
import type { DeviceInfo } from "@bugberry/shared"
import { consoleEntries, type DebuggerView, isFailedRequest, type ViewAction, type ViewEvent } from "./debugger-events"

export interface VisitedUrl {
  /** Time since the recording started (or since the first page, for a screenshot). */
  atMs: number
  url: string
  /** The page the report was made on (where a video started). */
  reported: boolean
  /** Console errors and uncaught errors while this page was open. */
  errors: number
  failedRequests: number
  /** The event times this page covers: from its navigation (null: the start) until the next page's (null: the end). */
  from: number | null
  to: number | null
}

function navigations(view: DebuggerView | null): ViewAction[] {
  if (!view) return []
  return view.events
    .filter((event): event is ViewAction => event.kind === "action" && event.type === "navigate" && Boolean(event.url ?? event.target))
    .sort((a, b) => a.t - b.t)
}

/** Whether an event happened while this page was open. */
export function onPage(page: Pick<VisitedUrl, "from" | "to">, t: number): boolean {
  return (page.from === null || t >= page.from) && (page.to === null || t < page.to)
}

function withCounts(page: Omit<VisitedUrl, "errors" | "failedRequests">, events: readonly ViewEvent[]): VisitedUrl {
  const on = events.filter((event) => onPage(page, event.t))
  return {
    ...page,
    errors: consoleEntries(on).filter((entry) => entry.level === "error").length,
    failedRequests: on.filter((event) => event.kind === "network" && isFailedRequest(event)).length,
  }
}

/**
 * The pages the person went through, in order; repeated loads of the same page count once. Each counts the errors
 * and failed requests from its navigation until the next page's; the first page also takes what came before it.
 */
export function visitedUrls(view: DebuggerView | null, pageUrl: string): VisitedUrl[] {
  const events = view?.events ?? []
  const steps = navigations(view)
  const first = steps[0]
  if (!first) return [withCounts({ atMs: 0, url: pageUrl, reported: true, from: null, to: null }, events)]
  const origin = view?.recordingStartedAt ?? first.t
  const visited: Array<Omit<VisitedUrl, "errors" | "failedRequests">> = []
  for (const step of steps) {
    const url = step.url ?? step.target ?? ""
    if (visited.at(-1)?.url === url) continue
    const previous = visited.at(-1)
    if (previous) previous.to = step.t
    visited.push({ atMs: visited.length === 0 ? 0 : Math.max(0, step.t - origin), url, reported: false, from: previous ? step.t : null, to: null })
  }
  const last = visited.findLastIndex((entry) => entry.url === pageUrl)
  if (last >= 0) visited[last] = { ...visited[last], reported: true } as VisitedUrl
  return visited.map((page) => withCounts(page, events))
}

/** How many typed values were hidden before upload. */
export function maskedCount(view: DebuggerView | null): number {
  if (!view) return 0
  return view.events.filter((event) => event.kind === "action" && event.type === "input" && isMaskedValue(event.value)).length
}

export interface EnvironmentRow {
  label: string
  value: string
  /** "Fast" or "Slow" next to the network speed. */
  tag?: string
}

/** The Info tab's Environment section; reports made before it was recorded fall back to their device. */
export function environmentRows(view: DebuggerView | null, device: DeviceInfo): EnvironmentRow[] {
  const environment = view?.environment ?? null
  const size = device.viewport.replace(/\s*x\s*/i, " \u00d7 ")
  const ratio = environment?.pixelRatio
  const rows: EnvironmentRow[] = [
    { label: "OS", value: environment?.osVersion ?? device.os },
    { label: "Browser", value: environment?.browserVersion ?? device.browser },
    { label: "Window size", value: ratio ? `${size} at ${ratio}\u00d7 pixel ratio` : size },
  ]
  const connection = environment?.connection
  if (connection) {
    const parts = [
      connection.effectiveType?.toUpperCase(),
      connection.downlinkMbps !== null ? `${connection.downlinkMbps} Mbps` : null,
      connection.rttMs !== null ? `${connection.rttMs} ms latency` : null,
    ].filter(Boolean)
    if (parts.length > 0) {
      rows.push({ label: "Network speed", value: parts.join(", "), tag: connection.effectiveType === "4g" ? "Fast" : "Slow" })
    }
  }
  const language = [environment?.language, environment?.timeZone ? `timezone ${environment.timeZone}` : null].filter(Boolean)
  if (language.length > 0) rows.push({ label: "Language", value: language.join(", ") })
  return rows
}
