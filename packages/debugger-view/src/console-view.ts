import type { ConsoleLevel } from "@bugberry/capture"
import { actionSentence, viaText } from "./action-view"
import {
  consoleEntries,
  consoleEntry,
  isFailedRequest,
  type NavigationVia,
  type ViewAction,
  type ViewEvent,
  type ViewNetwork,
} from "./debugger-events"

/**
 * One line of the Console tab. `key` names the event it came from, so it stays the same however the lines are
 * filtered, and a list keyed by it keeps the lines that stay instead of rebuilding them all.
 */
export type ConsoleRow = { key: string } & (
  | { t: number; kind: "log"; level: ConsoleLevel; text: string; stack: string | null; uncaught: boolean; source: string | null }
  | { t: number; kind: "navigation"; url: string; via: NavigationVia | null }
  | { t: number; kind: "marker"; text: "Recording started" | "Recording stopped" }
  | { t: number; kind: "network-error"; text: string }
  | { t: number; kind: "activity"; text: string }
)

export interface ConsoleOptions {
  level: ConsoleLevel | "all"
  query: string
  navigations: boolean
  networkErrors: boolean
  activity: boolean
}

/** "Navigated to https://shop.test/pay via History API". */
export function navigationText(row: { url: string; via: NavigationVia | null }): string {
  return [`Navigated to ${row.url}`, viaText(row.via)].filter(Boolean).join(" ")
}

function rowText(row: ConsoleRow): string {
  return row.kind === "navigation" ? navigationText(row) : row.text
}

/** The Console tab's timeline: logs and page errors, with navigations, failed requests and activity mixed in. */
export function consoleRows(
  events: readonly ViewEvent[],
  options: ConsoleOptions,
  recording?: { startedAt: number; durationMs: number | null },
): ConsoleRow[] {
  const rows: ConsoleRow[] = []
  if (recording) {
    rows.push({ key: "start", t: recording.startedAt, kind: "marker", text: "Recording started" })
    if (recording.durationMs !== null) {
      rows.push({ key: "stop", t: recording.startedAt + recording.durationMs, kind: "marker", text: "Recording stopped" })
    }
  }
  events.forEach((event, index) => {
    const entry = consoleEntry(event)
    if (entry && (options.level === "all" || entry.level === options.level)) rows.push({ key: `e${index}`, kind: "log", ...entry })
  })
  events.forEach((event, index) => {
    if (event.kind === "action") addAction(rows, event, index, options)
    if (event.kind === "network" && options.networkErrors && isFailedRequest(event)) {
      rows.push({ key: `e${index}`, t: event.t, kind: "network-error", text: networkErrorText(event) })
    }
  })
  const query = options.query.trim().toLowerCase()
  return rows
    .filter((row) => !query || rowText(row).toLowerCase().includes(query))
    .sort((a, b) => a.t - b.t)
}

function addAction(rows: ConsoleRow[], action: ViewAction, index: number, options: ConsoleOptions) {
  if (action.type === "navigate") {
    const url = action.url ?? action.target
    if (options.navigations && url) rows.push({ key: `e${index}`, t: action.t, kind: "navigation", url, via: action.via })
  } else if (options.activity && (action.type === "click" || action.type === "input")) {
    rows.push({ key: `e${index}`, t: action.t, kind: "activity", text: actionSentence(action).text })
  }
}

function networkErrorText(request: ViewNetwork): string {
  return `${request.method} ${request.url} ${request.status ?? "failed"}`
}

export function consoleCounts(events: readonly ViewEvent[]): { errors: number; warnings: number; info: number } {
  const counts = { errors: 0, warnings: 0, info: 0 }
  for (const entry of consoleEntries(events)) {
    if (entry.level === "error") counts.errors++
    else if (entry.level === "warn") counts.warnings++
    else counts.info++
  }
  return counts
}
