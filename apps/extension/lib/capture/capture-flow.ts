import {
  BUFFER_MAX_EVENTS,
  type CaptureEvent,
  DEBUGGER_PAYLOAD_VERSION,
  type DebuggerPayload,
  redactUrl,
} from "@bugberry/capture"
import type { ScreenshotMode } from "./capture-prefs"
import { deviceInfoFrom } from "./device"
import { environmentFrom } from "./environment"
import type { DraftStore } from "../draft-store"
import { type AreaPick, type AreaRect, areaPickFrom } from "./select-area"

export type PageCapture =
  | { status: "ok"; events: CaptureEvent[]; incomplete: string[]; documentId?: string }
  | { status: "missing" }

export interface ActiveTab {
  id: number
  windowId: number
  /** False when the tab is not the one showing in its window; captureVisibleTab would capture another tab. */
  active?: boolean
  url?: string
  title?: string
  width?: number
  height?: number
}

export interface CaptureFlowDeps {
  /** Resolves to a PNG data URL of the visible part of the tab. */
  captureVisibleTab(windowId: number): Promise<string>
  /** Raw result of reading the page's capture session; validated before use. */
  /** `keep`: during a recording, only events of this take outside its pauses, chosen before the page's own cut. */
  readPageCapture(tabId: number, keep?: CaptureWindow): Promise<unknown>
  /** Raw answer of the page about its language, screen and connection; validated before use. */
  readEnvironment(tabId: number): Promise<unknown>
  /** The review modal over the tab, or in a tab of its own when the page can't show it. */
  openReview(draftId: string, tabId: number): Promise<void>
  /** Runs the drag overlay (`pickArea`) in the tab; its raw answer is validated before use. */
  pickArea(tabId: number): Promise<unknown>
  /** The part of the PNG under `rect` (CSS pixels), at the page's pixel ratio. */
  cropImage(dataUrl: string, rect: AreaRect, pixelRatio: number): Promise<Blob>
  store: DraftStore
  /** How long to wait for a busy or hostile page before sending the report without its buffer. */
  pageReadTimeoutMs?: number
  userAgent: string
  now(): number
  newId(): string
}

/** The part of a page's buffer a recording keeps: from its start, outside its pauses (epoch ms). */
export interface CaptureWindow {
  since: number
  pauses: Array<{ start: number; end: number }>
}

export type CaptureResult =
  | { ok: true; draftId: string }
  /**
   * Not failures to flag: `already-recording` is refused because a recording is running, and
   * `cancelled` means the reporter backed out (closed Chrome's share picker, pressed Esc).
   */
  | { ok: false; error: string; code?: "already-recording" | "cancelled" }

const EVENT_KINDS = new Set(["console", "error", "network", "action", "resource", "page"])
const INCOMPLETE_NAME = /^[a-z0-9-]{1,50}$/
const DOCUMENT_ID = /^[a-z0-9-]{1,64}$/
/** Real events stay far below this (bodies are cut to 10 KB at the source); bigger ones are forged. */
const MAX_EVENT_CHARS = 64 * 1024
const MAX_PAYLOAD_CHARS = 8 * 1024 * 1024
const PAGE_READ_TIMEOUT_MS = 2000

function sizeOf(event: CaptureEvent): number {
  try {
    return JSON.stringify(event).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Keeps the newest events that fit in the payload budget. */
export function withinBudget(events: CaptureEvent[]): CaptureEvent[] {
  const kept: CaptureEvent[] = []
  let total = 2
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as CaptureEvent
    const size = sizeOf(event)
    if (size > MAX_EVENT_CHARS) continue
    if (total + size + 1 > MAX_PAYLOAD_CHARS) break
    total += size + 1
    kept.push(event)
  }
  return kept.reverse()
}
const BLOCKED_HOSTS = new Set(["chrome.google.com", "chromewebstore.google.com", "addons.mozilla.org", "addons.opera.com"])

function isEvent(value: unknown): value is CaptureEvent {
  if (typeof value !== "object" || value === null) return false
  const event = value as { kind?: unknown; t?: unknown }
  return typeof event.kind === "string" && EVENT_KINDS.has(event.kind) && typeof event.t === "number"
}

/** The page controls this data, so only well-formed events are kept. */
export function sanitizePageCapture(raw: unknown): PageCapture | null {
  if (typeof raw !== "object" || raw === null) return null
  const value = raw as { status?: unknown; events?: unknown; incomplete?: unknown; documentId?: unknown }
  if (value.status === "missing") return { status: "missing" }
  if (value.status !== "ok" || !Array.isArray(value.events)) return null
  const events = withinBudget(value.events.filter(isEvent).slice(-BUFFER_MAX_EVENTS))
  const incomplete = Array.isArray(value.incomplete)
    ? value.incomplete
        .filter((name): name is string => typeof name === "string" && INCOMPLETE_NAME.test(name))
        .slice(0, 20)
    : []
  const documentId = typeof value.documentId === "string" && DOCUMENT_ID.test(value.documentId) ? value.documentId : undefined
  return { status: "ok", events, incomplete, ...(documentId ? { documentId } : {}) }
}

export const UNCAPTURABLE = "This page can't be captured. Open a regular web page (http/https)."

export function capturable(url: string | undefined): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !BLOCKED_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Waits for `work` at most `ms`; a failure or a timeout gives null. */
async function within<T>(work: () => Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function debuggerPayloadFor(
  tabId: number,
  deps: Pick<CaptureFlowDeps, "readPageCapture" | "readEnvironment" | "pageReadTimeoutMs" | "now">,
  recordingStartedAt: number | null = null,
): Promise<DebuggerPayload> {
  return (await pagePayloadFor(tabId, deps, recordingStartedAt)).payload
}

/** The payload for the page open now, plus that page's document id when it answered with one. */
export async function pagePayloadFor(
  tabId: number,
  deps: Pick<CaptureFlowDeps, "readPageCapture" | "readEnvironment" | "pageReadTimeoutMs" | "now">,
  recordingStartedAt: number | null = null,
  keep?: CaptureWindow,
): Promise<{ payload: DebuggerPayload; documentId: string | null }> {
  // Read alongside the capture buffer; a page that does not answer only loses the environment.
  const environment = within(() => deps.readEnvironment(tabId), deps.pageReadTimeoutMs ?? PAGE_READ_TIMEOUT_MS).then(
    environmentFrom,
  )
  const { payload, documentId } = await capturedPayload(tabId, deps, recordingStartedAt, keep)
  const described = await environment
  return { payload: described ? { ...payload, environment: described } : payload, documentId }
}

async function capturedPayload(
  tabId: number,
  deps: Pick<CaptureFlowDeps, "readPageCapture" | "pageReadTimeoutMs" | "now">,
  recordingStartedAt: number | null,
  keep?: CaptureWindow,
): Promise<{ payload: DebuggerPayload; documentId: string | null }> {
  const base: Pick<DebuggerPayload, "version" | "capturedAt" | "recordingStartedAt"> = {
    version: DEBUGGER_PAYLOAD_VERSION,
    capturedAt: deps.now(),
    recordingStartedAt,
  }
  const timeout = Symbol("timeout")
  let timer: ReturnType<typeof setTimeout> | undefined
  let page: PageCapture | null
  try {
    const raw = await Promise.race([
      keep ? deps.readPageCapture(tabId, keep) : deps.readPageCapture(tabId),
      new Promise<typeof timeout>((resolve) => {
        timer = setTimeout(() => resolve(timeout), deps.pageReadTimeoutMs ?? PAGE_READ_TIMEOUT_MS)
      }),
    ])
    if (raw === timeout) return { payload: { ...base, incomplete: ["page-timeout"], events: [] }, documentId: null }
    page = sanitizePageCapture(raw)
  } catch {
    page = null
  } finally {
    clearTimeout(timer)
  }
  if (!page) return { payload: { ...base, incomplete: ["page-access"], events: [] }, documentId: null }
  if (page.status === "missing") return { payload: { ...base, incomplete: ["not-injected"], events: [] }, documentId: null }
  return { payload: { ...base, incomplete: page.incomplete, events: page.events }, documentId: page.documentId ?? null }
}

export async function startScreenshotReport(
  tab: ActiveTab,
  deps: CaptureFlowDeps,
  mode: ScreenshotMode = "visible",
): Promise<CaptureResult> {
  if (!capturable(tab.url)) {
    return { ok: false, error: UNCAPTURABLE }
  }
  if (tab.active === false) {
    return { ok: false, error: "That tab isn't showing. Switch to it and take the screenshot again." }
  }

  // Select area: the reporter drags a box first; a page that answers nonsense counts as a cancel.
  let pick: AreaPick | null = null
  if (mode === "area") {
    let answer: unknown
    try {
      answer = await deps.pickArea(tab.id)
    } catch {
      // The overlay couldn't be put on the page (an error page, a page still loading, one Chrome protects).
      return { ok: false, error: "BugBerry can't reach this page. Reload it and try again." }
    }
    pick = areaPickFrom(answer) ?? { kind: "cancel" }
  }
  if (pick?.kind === "cancel") return { ok: false, code: "cancelled", error: "Cancelled" }

  let dataUrl: string
  let screenshot: Blob
  try {
    dataUrl = await deps.captureVisibleTab(tab.windowId)
    screenshot = pick?.kind === "area" ? await deps.cropImage(dataUrl, pick.rect, pick.pixelRatio) : await (await fetch(dataUrl)).blob()
  } catch (error) {
    return { ok: false, error: `Screenshot failed: ${messageOf(error)}` }
  }

  const debuggerPayload = await debuggerPayloadFor(tab.id, deps)
  const id = deps.newId()
  await deps.store.put({
    id,
    createdAt: deps.now(),
    captureType: "screenshot",
    page: { url: redactUrl(tab.url), title: tab.title ?? "" },
    device: deviceInfoFrom(deps.userAgent, { width: tab.width, height: tab.height }),
    screenshot,
    debuggerPayload,
    debuggerGzip: null,
    status: "editing",
    error: null,
    session: null,
    form: null,
    annotations: [],
    tabId: tab.id,
    screenshotMode: mode,
  })
  await deps.openReview(id, tab.id)
  return { ok: true, draftId: id }
}
