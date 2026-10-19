import type { DebuggerSummary } from "@bugberry/shared"
import { createEventBuffer } from "./buffer"
import type { CaptureEvent, Emit, Uninstall } from "./events"
import { type ActionHost, installActionHooks } from "./hooks/actions"
import { type ConsoleLike, installConsoleHook } from "./hooks/console"
import { type ErrorHost, installErrorHooks } from "./hooks/errors"
import { type FetchHost, installFetchHook } from "./hooks/fetch"
import { installResourceHooks, type ResourceHost } from "./hooks/resources"
import { installWebSocketHook, type WebSocketHost } from "./hooks/websocket"
import { installXhrHook, type XhrHost } from "./hooks/xhr"
import { createStackBudget, currentStack } from "./callsite"
import { safely } from "./safe"
import { summarize } from "./summary"

export type CaptureWindow = ErrorHost &
  FetchHost &
  XhrHost &
  ActionHost &
  ResourceHost &
  WebSocketHost & { console: ConsoleLike }

export interface CaptureOptions {
  /** Defaults to the current global window. */
  window?: CaptureWindow
  now?: () => number
  maxAgeMs?: number
  maxEvents?: number
}

/** DOM events between this script (MAIN world) and the extension's flush script (ISOLATED world). */
export const FLUSH_REQUEST_EVENT = "bugberry:flush-request"
export const FLUSH_EVENT = "bugberry:flush"
/** Isolated world → this script: the recording is paused ("on") or resumed ("off"); paused events aren't kept. */
export const CAPTURE_PAUSE_EVENT = "bugberry:capture-pause"

function newDocumentId(): string {
  // crypto.randomUUID needs a secure context; plain http pages have none.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export interface CaptureSession {
  /** Identifies this document, so a recording across reloads keeps each page's events once. */
  readonly documentId: string
  /** Ordered copy of the buffered events. */
  snapshot(): CaptureEvent[]
  summary(): DebuggerSummary
  /** Hooks that could not be installed on this page. */
  readonly incomplete: readonly string[]
  clear(): void
  /** Removes every hook; a later `startCapture` creates a new session. */
  stop(): void
}

const SESSION_KEY = Symbol.for("bugberry.capture.session")

type SessionRegistry = { [SESSION_KEY]?: CaptureSession }

export function startCapture(options: CaptureOptions = {}): CaptureSession {
  const win = options.window ?? (globalThis as unknown as CaptureWindow)
  const registry = win as unknown as SessionRegistry
  const existing = registry[SESSION_KEY]
  if (existing) return existing

  const now = options.now ?? Date.now
  const buffer = createEventBuffer({ maxAgeMs: options.maxAgeMs, maxEvents: options.maxEvents, now })
  let stopped = false
  // While a recording is paused nothing is kept: those events would be dropped anyway, and a noisy pause
  // must not push the take's earlier events out of the buffer.
  let paused = false
  // A hook the page wrapped again stays in its chain after stop; it must not record into this session.
  const emit: Emit = (event) => {
    if (!stopped && !paused) buffer.push(event)
  }
  const incomplete: string[] = []
  const uninstallers: Uninstall[] = []
  const documentId = newDocumentId()

  // One budget for every hook: console, fetch and XHR call sites together.
  const stackOf = createStackBudget(currentStack, now)
  const hooks: Array<[name: string, install: () => Uninstall]> = [
    ["console", () => installConsoleHook(win.console, emit, now, stackOf)],
    ["errors", () => installErrorHooks(win, emit, now)],
    ["fetch", () => installFetchHook(win, emit, now, stackOf)],
    ["xhr", () => installXhrHook(win, emit, now, stackOf)],
    ["actions", () => installActionHooks(win, emit, now, (event) => buffer.has(event))],
    ["resources", () => installResourceHooks(win, emit)],
    ["websocket", () => installWebSocketHook(win, emit, now)],
  ]
  for (const [name, install] of hooks) {
    try {
      uninstallers.push(install())
    } catch {
      incomplete.push(name)
    }
  }

  // Answered synchronously, so it still works inside the page's pagehide handler. The detail is a string:
  // objects do not cross from the MAIN world to the extension's isolated world.
  const onFlushRequest = () =>
    safely(() => {
      const Custom = (win as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent ?? CustomEvent
      const detail = JSON.stringify({ documentId, events: buffer.snapshot(), incomplete })
      win.document.dispatchEvent(new Custom(FLUSH_EVENT, { detail }))
    })
  win.document.addEventListener(FLUSH_REQUEST_EVENT, onFlushRequest)
  uninstallers.push(() => win.document.removeEventListener(FLUSH_REQUEST_EVENT, onFlushRequest))
  const onPause = (event: Event) => {
    paused = (event as CustomEvent).detail === "on"
  }
  win.document.addEventListener(CAPTURE_PAUSE_EVENT, onPause)
  uninstallers.push(() => win.document.removeEventListener(CAPTURE_PAUSE_EVENT, onPause))

  const session: CaptureSession = {
    documentId,
    snapshot: () => buffer.snapshot(),
    summary: () => summarize(buffer.snapshot(), incomplete),
    incomplete,
    clear: () => buffer.clear(),
    stop: () => {
      stopped = true
      for (const uninstall of uninstallers.reverse()) safely(uninstall)
      uninstallers.length = 0
      if (registry[SESSION_KEY] === session) delete registry[SESSION_KEY]
    },
  }
  registry[SESSION_KEY] = session
  return session
}
