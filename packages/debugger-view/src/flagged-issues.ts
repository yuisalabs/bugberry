import type { DebuggerView, ViewAction, ViewNetwork } from "./debugger-events"
import { networkRows, requestPath, requestState } from "./network-view"

export type IssueLevel = 1 | 2 | 3 | 4
export type IssueTime = { kind: "video"; offsetMs: number } | { kind: "before" } | { kind: "after" } | { kind: "none" }
export type IssueTarget = { tab: "console" | "actions" } | { tab: "network"; rowKey: string }

/** One line of the "BugBerry flagged" box: a problem, or several of the same problem merged. */
export interface FlaggedIssue {
  key: string
  level: IssueLevel
  text: string
  /** "checkout.js:2481": where an error came from, when known. */
  source: string | null
  count: number
  time: IssueTime
  target: IssueTarget
}

interface Group {
  key: string
  level: IssueLevel
  base: string
  source: string | null
  count: number
  /** Rage clicks: the largest number of presses in one streak. */
  presses: number
  firstT: number
  firstInVideoT: number | null
  target: IssueTarget
  rage: boolean
}

/** A console line may repeat an error's message inside a longer text only if the message is this long… */
const MIN_CONTAINED_MESSAGE = 15
/** …and only this close in time; shorter messages ("Error", "null") must match exactly. */
const REPEAT_WINDOW_MS = 1000

/** "Uncaught TypeError: x" and "TypeError: x" are the same error. */
const errorKey = (message: string) => message.replace(/^Uncaught\s+/, "").trim()

/** "https://shop.test/js/app.js:3:9" → "app.js:3". */
function shortSource(source: string | null): string | null {
  if (!source) return null
  const match = source.match(/([^/\\]+?):(\d+)(?::\d+)?$/)
  return match ? `${match[1]}:${match[2]}` : source
}

function pathOf(url: string): string {
  return requestPath(url).split("?")[0] ?? url
}

/**
 * Every problem in a recording, merged and ranked for the "BugBerry flagged" box: uncaught errors,
 * then 5xx responses, then requests without an answer and rage clicks, then 4xx and console.error.
 * `video` is null for screenshots; times are offsets into the video, or a label when outside it.
 */
export function flaggedIssues(
  view: DebuggerView,
  video: { startedAt: number | null; durationMs: number | null } | null,
): FlaggedIssue[] {
  const groups = new Map<string, Group>()
  const rowKeys = new Map<ViewNetwork, string>()
  for (const row of networkRows(view.events)) if (row.request) rowKeys.set(row.request, row.key)

  const inVideo = (t: number) => {
    if (!video || video.startedAt === null) return false
    const offset = t - video.startedAt
    return offset >= 0 && (video.durationMs === null || offset <= video.durationMs)
  }

  /** One more occurrence of a problem already in the box. */
  const bump = (group: Group, t: number, presses = 0) => {
    group.count += 1
    group.presses = Math.max(group.presses, presses)
    if (inVideo(t) && (group.firstInVideoT === null || t < group.firstInVideoT)) group.firstInVideoT = t
    if (t < group.firstT) group.firstT = t
  }

  const add = (key: string, t: number, make: () => Omit<Group, "key" | "count" | "firstT" | "firstInVideoT" | "presses">, presses = 0) => {
    const group = groups.get(key)
    if (group) bump(group, t, presses)
    else groups.set(key, { key, count: 1, presses, firstT: t, firstInVideoT: inVideo(t) ? t : null, ...make() })
  }

  // Uncaught errors first, so console.error lines repeating them can join their rows.
  const errorTimes = new Map<string, number[]>()
  const longMessages: string[] = []
  for (const event of view.events) {
    if (event.kind !== "error") continue
    const message = errorKey(event.message)
    const key = `error:${message}`
    const times = errorTimes.get(message)
    if (times) times.push(event.t)
    else {
      errorTimes.set(message, [event.t])
      if (message.length >= MIN_CONTAINED_MESSAGE) longMessages.push(message)
    }
    add(key, event.t, () => ({
      level: 1,
      base: /^(Uncaught|Unhandled)\b/.test(event.message) ? event.message : `Uncaught ${event.message}`,
      source: shortSource(event.source),
      target: { tab: "console" },
      rage: false,
    }))
  }

  for (const event of view.events) {
    if (event.kind === "console" && event.level === "error") {
      // Frameworks often log an uncaught error a second time; that copy joins the error's row.
      const repeated = repeatedError(event.text, event.t)
      const errorGroup = repeated === null ? undefined : groups.get(`error:${repeated}`)
      if (errorGroup) {
        bump(errorGroup, event.t)
        continue
      }
      add(`console:${event.text}`, event.t, () => ({
        level: 4,
        base: `console.error: ${event.text}`,
        source: event.source,
        target: { tab: "console" },
        rage: false,
      }))
    } else if (event.kind === "network") {
      addRequest(event)
    } else if (event.kind === "action" && event.type === "rage-click") {
      addRage(event)
    }
  }

  /** The uncaught error a console line repeats: the same message, or a long one logged right after it. */
  function repeatedError(text: string, t: number): string | null {
    const exact = errorKey(text)
    if (errorTimes.has(exact)) return exact
    for (const message of longMessages) {
      if (!text.includes(message)) continue
      if (errorTimes.get(message)?.some((errorT) => Math.abs(t - errorT) <= REPEAT_WINDOW_MS)) return message
    }
    return null
  }

  function addRequest(request: ViewNetwork) {
    const state = requestState(request)
    const status = request.status
    const level: IssueLevel | null =
      state === "canceled" ? 3 : status !== null && status >= 500 ? 2 : status !== null && status >= 400 ? 4 : null
    if (level === null) return
    const outcome = state === "canceled" ? ", no response" : ` → ${status}`
    const base = `${request.method} ${pathOf(request.url)}${outcome}`
    const rowKey = rowKeys.get(request) ?? ""
    add(`request:${base}`, request.t, () => ({ level, base, source: null, target: { tab: "network", rowKey }, rage: false }))
  }

  function addRage(action: ViewAction) {
    const target = action.target ?? "the page"
    const presses = Number(action.value) || 3
    add(`rage:${target}`, action.t, () => ({ level: 3, base: target, source: null, target: { tab: "actions" }, rage: true }), presses)
  }

  const timeOf = (group: Group): IssueTime => {
    if (!video || video.startedAt === null) return { kind: "none" }
    const t = group.firstInVideoT ?? group.firstT
    const offset = t - video.startedAt
    if (offset < 0) return { kind: "before" }
    if (video.durationMs !== null && offset > video.durationMs) return { kind: "after" }
    return { kind: "video", offsetMs: offset }
  }

  return [...groups.values()]
    .map((group) => ({ group, t: group.firstInVideoT ?? group.firstT }))
    .sort((a, b) => a.group.level - b.group.level || a.t - b.t)
    .map(({ group }) => ({
      key: group.key,
      level: group.level,
      text: group.rage
        ? `Rage click ×${group.presses} on ${group.base}${group.count > 1 ? ` · ${group.count} times` : ""}`
        : `${group.base}${group.count > 1 ? ` ×${group.count}` : ""}`,
      source: group.source,
      count: group.count,
      time: timeOf(group),
      target: group.target,
    }))
}
