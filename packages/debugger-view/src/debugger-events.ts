import type { ConsoleLevel } from "@bugberry/capture"

/**
 * debugger.json.gz is written by a page we do not control, so only `kind` and `t` are trusted.
 * Every other field is type-checked, length-capped and turned into plain strings here; components
 * render these values as text only.
 */

export const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const satisfies readonly ConsoleLevel[]
export const ACTION_TYPES = ["click", "input", "submit", "navigate", "scroll", "rage-click", "visibility"] as const
export const NAVIGATION_VIAS = ["load", "reload", "back-forward", "history"] as const
export type NavigationVia = (typeof NAVIGATION_VIAS)[number]
const PAGE_VIAS = ["load", "reload", "back-forward"] as const
export type ViewActionType = (typeof ACTION_TYPES)[number] | "other"

export interface ViewConsole {
  kind: "console"
  t: number
  level: ConsoleLevel
  text: string
  stack: string | null
  /** "cart.js:88": the page code that logged it; null for older reports. */
  source: string | null
}

export interface ViewError {
  kind: "error"
  t: number
  message: string
  stack: string | null
  source: string | null
}

export interface ViewNetwork {
  kind: "network"
  t: number
  method: string
  url: string
  status: number | null
  durationMs: number | null
  requestHeaders: Array<[string, string]>
  responseHeaders: Array<[string, string]>
  requestBody: string | null
  responseBody: string | null
  failed: string | null
  /** Still waiting for its response when the report was taken. */
  pending: boolean
  /** "api.js:41": the page code that started the request. */
  initiator: string | null
}

export interface ViewTiming {
  queueMs: number
  dnsMs: number
  connectMs: number
  tlsMs: number
  ttfbMs: number
  downloadMs: number
}

/** A file the page loaded, from the browser's timing records. */
export interface ViewResource {
  kind: "resource"
  t: number
  url: string
  initiatorType: string
  durationMs: number | null
  transferSize: number | null
  decodedSize: number | null
  cache: "memory" | "disk" | null
  timing: ViewTiming | null
}

/** One document of the recording: how it was opened and when it finished loading. */
export interface ViewPage {
  kind: "page"
  t: number
  url: string
  via: (typeof PAGE_VIAS)[number]
  domContentLoadedMs: number | null
  loadMs: number | null
  transferSize: number | null
}

export interface ViewEnvironment {
  language: string | null
  timeZone: string | null
  pixelRatio: number | null
  connection: { effectiveType: string | null; downlinkMbps: number | null; rttMs: number | null } | null
  browserVersion: string | null
  osVersion: string | null
}

export interface ViewAction {
  kind: "action"
  t: number
  type: ViewActionType
  target: string | null
  value: string | null
  url: string | null
  /** For navigations: how the page got there. */
  via: NavigationVia | null
}

export type ViewEvent = ViewConsole | ViewError | ViewNetwork | ViewAction | ViewResource | ViewPage

export interface ViewNote {
  n: number
  /** Video time, already without the paused parts. */
  atMs: number
  text: string
  author: string
}

export interface ViewPause {
  /** Video time where the recording was paused. */
  atMs: number
  /** How long it stayed paused. */
  ms: number
}

export interface DebuggerView {
  capturedAt: number | null
  recordingStartedAt: number | null
  incomplete: string[]
  events: ViewEvent[]
  /** The reporter's language, screen and connection; null for reports made before it was recorded. */
  environment: ViewEnvironment | null
  /** Numbered notes pinned while recording; empty for screenshots and older reports. */
  notes: ViewNote[]
  pauses: ViewPause[]
}

export const MAX_EVENTS = 5000
export const MAX_TEXT = 20_000
const MAX_ENTRIES = 100
const MAX_NAME = 200
const MAX_INCOMPLETE = 20
const MAX_SHORT = 200
const DAY_MS = 86_400_000
const MAX_BYTES = 10_000_000_000

type Raw = Record<string, unknown>

function truncate(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
}

function text(value: unknown): string | null {
  if (typeof value === "string") return truncate(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return null
}

function headerList(value: unknown): Array<[string, string]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return []
  return Object.entries(value)
    .slice(0, MAX_ENTRIES)
    .map(([name, headerValue]): [string, string] => [name.slice(0, MAX_NAME), text(headerValue) ?? ""])
}

function boundedInt(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : null
}

/** A short label (call site, type, version): capped hard, since it is never shown in full. */
function shortText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_SHORT) : null
}

function amount(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null
}

function timingOf(value: unknown): ViewTiming | null {
  if (typeof value !== "object" || value === null) return null
  const raw = value as Raw
  const keys = ["queueMs", "dnsMs", "connectMs", "tlsMs", "ttfbMs", "downloadMs"] as const
  const parts = keys.map((key) => boundedInt(raw[key], DAY_MS))
  if (parts.some((part) => part === null)) return null
  const [queueMs, dnsMs, connectMs, tlsMs, ttfbMs, downloadMs] = parts as number[]
  return { queueMs, dnsMs, connectMs, tlsMs, ttfbMs, downloadMs } as ViewTiming
}

function environmentOf(value: unknown): ViewEnvironment | null {
  if (typeof value !== "object" || value === null) return null
  const raw = value as Raw
  const connection = typeof raw.connection === "object" && raw.connection !== null ? (raw.connection as Raw) : null
  const described = connection
    ? {
        effectiveType: shortText(connection.effectiveType),
        downlinkMbps: amount(connection.downlinkMbps, 100_000),
        rttMs: amount(connection.rttMs, 60_000),
      }
    : null
  const pixelRatio = amount(raw.pixelRatio, 8)
  return {
    language: shortText(raw.language),
    timeZone: shortText(raw.timeZone),
    pixelRatio: pixelRatio !== null && pixelRatio >= 0.5 ? pixelRatio : null,
    connection: described && Object.values(described).some((part) => part !== null) ? described : null,
    browserVersion: shortText(raw.browserVersion),
    osVersion: shortText(raw.osVersion),
  }
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((option) => option === value) ?? null
}

function normalizeEvent(raw: unknown): ViewEvent | null {
  if (typeof raw !== "object" || raw === null) return null
  const event = raw as Raw
  const t = timestamp(event.t)
  if (t === null) return null
  switch (event.kind) {
    case "console": {
      const args = Array.isArray(event.args) ? event.args.slice(0, MAX_ENTRIES) : []
      const parts = args.map(text).filter((part): part is string => part !== null)
      return {
        kind: "console",
        t,
        level: oneOf(event.level, CONSOLE_LEVELS) ?? "log",
        text: truncate(parts.join(" ")),
        stack: text(event.stack),
        source: shortText(event.source),
      }
    }
    case "error":
      return { kind: "error", t, message: text(event.message) ?? "", stack: text(event.stack), source: text(event.source) }
    case "network":
      return {
        kind: "network",
        t,
        method: (text(event.method) ?? "GET").slice(0, 20).toUpperCase(),
        url: text(event.url) ?? "",
        status: boundedInt(event.status, 999),
        durationMs: boundedInt(event.durationMs, 86_400_000),
        requestHeaders: headerList(event.requestHeaders),
        responseHeaders: headerList(event.responseHeaders),
        requestBody: text(event.requestBody),
        responseBody: text(event.responseBody),
        failed: text(event.failed),
        pending: event.pending === true,
        initiator: shortText(event.initiator),
      }
    case "action":
      return {
        kind: "action",
        t,
        type: oneOf(event.type, ACTION_TYPES) ?? "other",
        target: text(event.target),
        value: text(event.value),
        url: text(event.url),
        via: oneOf(event.via, NAVIGATION_VIAS),
      }
    case "resource":
      return {
        kind: "resource",
        t,
        url: text(event.url) ?? "",
        initiatorType: shortText(event.initiatorType)?.toLowerCase() ?? "other",
        durationMs: boundedInt(event.durationMs, DAY_MS),
        transferSize: boundedInt(event.transferSize, MAX_BYTES),
        decodedSize: boundedInt(event.decodedSize, MAX_BYTES),
        cache: oneOf(event.cache, ["memory", "disk"] as const),
        timing: timingOf(event.timing),
      }
    case "page":
      return {
        kind: "page",
        t,
        url: text(event.url) ?? "",
        via: oneOf(event.via, PAGE_VIAS) ?? "load",
        domContentLoadedMs: boundedInt(event.domContentLoadedMs, DAY_MS),
        loadMs: boundedInt(event.loadMs, DAY_MS),
        transferSize: boundedInt(event.transferSize, MAX_BYTES),
      }
    default:
      return null
  }
}

const MAX_NOTES = 100
const MAX_PAUSES = 200

function notesOf(value: unknown): ViewNote[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_NOTES).flatMap((raw): ViewNote[] => {
    const note = (typeof raw === "object" && raw !== null ? raw : {}) as Raw
    const n = boundedInt(note.n, 10_000)
    const atMs = boundedInt(note.atMs, DAY_MS)
    if (n === null || atMs === null || typeof note.text !== "string") return []
    return [{ n, atMs, text: note.text.slice(0, 500), author: typeof note.author === "string" ? note.author.slice(0, 100) : "" }]
  })
}

function pausesOf(value: unknown): ViewPause[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_PAUSES).flatMap((raw): ViewPause[] => {
    const pause = (typeof raw === "object" && raw !== null ? raw : {}) as Raw
    const atMs = boundedInt(pause.atMs, DAY_MS)
    const ms = boundedInt(pause.ms, DAY_MS)
    return atMs === null || ms === null ? [] : [{ atMs, ms }]
  })
}

export function normalizePayload(payload: unknown): DebuggerView {
  const raw = (typeof payload === "object" && payload !== null ? payload : {}) as Raw
  const rawEvents = Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : []
  const events = rawEvents
    .map(normalizeEvent)
    .filter((event): event is ViewEvent => event !== null)
    .sort((a, b) => a.t - b.t)
  const incomplete = Array.isArray(raw.incomplete)
    ? raw.incomplete
        .filter((name): name is string => typeof name === "string")
        .slice(0, MAX_INCOMPLETE)
        .map((name) => name.slice(0, 50))
    : []
  return {
    capturedAt: timestamp(raw.capturedAt),
    recordingStartedAt: timestamp(raw.recordingStartedAt),
    incomplete,
    events,
    environment: environmentOf(raw.environment),
    notes: notesOf(raw.notes),
    pauses: pausesOf(raw.pauses),
  }
}

export interface ConsoleEntry {
  t: number
  level: ConsoleLevel
  text: string
  stack: string | null
  /** An uncaught error or unhandled rejection rather than a console call. */
  uncaught: boolean
  /** "cart.js:88": where it came from, when known. */
  source: string | null
}

/** A console call or a page error as a console line; null for any other event. */
export function consoleEntry(event: ViewEvent): ConsoleEntry | null {
  if (event.kind === "console") {
    return { t: event.t, level: event.level, text: event.text, stack: event.stack, uncaught: false, source: event.source }
  }
  if (event.kind === "error") {
    const message = event.source ? `${event.message} (${event.source})` : event.message
    return { t: event.t, level: "error", text: message, stack: event.stack, uncaught: true, source: null }
  }
  return null
}

export function consoleEntries(events: readonly ViewEvent[]): ConsoleEntry[] {
  return events.map(consoleEntry).filter((entry): entry is ConsoleEntry => entry !== null)
}

export function isFailedRequest(event: ViewNetwork): boolean {
  return event.failed !== null || (event.status ?? 0) >= 400
}

export function filterNetwork(
  events: readonly ViewEvent[],
  filter: { failedOnly: boolean; query: string },
): ViewNetwork[] {
  const query = filter.query.trim().toLowerCase()
  return events
    .filter((event): event is ViewNetwork => event.kind === "network")
    .filter((event) => (!filter.failedOnly || isFailedRequest(event)) && (!query || event.url.toLowerCase().includes(query)))
}

/** Event times are shown relative to this moment: the video start, else the capture. */
export function eventBase(view: DebuggerView): number | null {
  return view.recordingStartedAt ?? view.capturedAt
}
