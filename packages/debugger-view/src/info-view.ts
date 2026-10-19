import { isMaskedValue } from "./action-view"
import type { DeviceInfo } from "@bugberry/shared"
import type { DebuggerView, ViewAction } from "./debugger-events"

export interface VisitedUrl {
  /** Time since the recording started (or since the first page, for a screenshot). */
  atMs: number
  url: string
  /** The page the report was made on. */
  bugHere: boolean
}

function navigations(view: DebuggerView | null): ViewAction[] {
  if (!view) return []
  return view.events
    .filter((event): event is ViewAction => event.kind === "action" && event.type === "navigate" && Boolean(event.url ?? event.target))
    .sort((a, b) => a.t - b.t)
}

/** The pages the person went through, in order; repeated loads of the same page count once. */
export function visitedUrls(view: DebuggerView | null, pageUrl: string): VisitedUrl[] {
  const steps = navigations(view)
  const first = steps[0]
  if (!first) return [{ atMs: 0, url: pageUrl, bugHere: true }]
  const origin = view?.recordingStartedAt ?? first.t
  const visited: VisitedUrl[] = []
  for (const step of steps) {
    const url = step.url ?? step.target ?? ""
    if (visited.at(-1)?.url === url) continue
    visited.push({ atMs: visited.length === 0 ? 0 : Math.max(0, step.t - origin), url, bugHere: false })
  }
  const last = visited.findLastIndex((entry) => entry.url === pageUrl)
  if (last >= 0) visited[last] = { ...visited[last], bugHere: true } as VisitedUrl
  return visited
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
