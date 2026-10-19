export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug"
export const CONSOLE_LEVELS: readonly ConsoleLevel[] = ["log", "info", "warn", "error", "debug"]

export type ActionType = "click" | "input" | "submit" | "navigate" | "scroll" | "rage-click" | "visibility"

/** `t` is always epoch milliseconds. */
export interface ConsoleEvent {
  kind: "console"
  t: number
  level: ConsoleLevel
  args: string[]
  stack?: string
  /** "file.js:88": the page code that made the call. */
  source?: string
}

export interface PageErrorEvent {
  kind: "error"
  t: number
  message: string
  stack?: string
  source?: string
}

export interface NetworkEvent {
  kind: "network"
  t: number
  method: string
  url: string
  status?: number
  durationMs?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  failed?: string
  /** "file.js:12": the page code that started the request. */
  initiator?: string
  /** Recorded when the request starts; set until the response (or failure) arrives. */
  pending?: true
}

export interface ActionEvent {
  kind: "action"
  t: number
  type: ActionType
  target?: string
  value?: string
  url?: string
  /** For navigations: how the page got there. Absent for hash changes. */
  via?: "load" | "reload" | "back-forward" | "history"
}

/** How long each phase of a request took; only same-origin (or Timing-Allow-Origin) requests have it. */
export interface ResourceTimingDetail {
  queueMs: number
  dnsMs: number
  connectMs: number
  tlsMs: number
  ttfbMs: number
  downloadMs: number
}

/** A file the page loaded (script, style, image, font, fetch…), from the browser's own timing records. */
export interface ResourceEvent {
  kind: "resource"
  t: number
  url: string
  /** The browser's initiatorType: "script", "link", "img", "fetch", "xmlhttprequest", … or "websocket". */
  initiatorType: string
  durationMs?: number
  transferSize?: number
  decodedSize?: number
  cache?: "memory" | "disk"
  timing?: ResourceTimingDetail
}

/** The document itself: when it started loading, how, and when DOMContentLoaded and load ended. */
export interface PageEvent {
  kind: "page"
  t: number
  url: string
  via: "load" | "reload" | "back-forward"
  domContentLoadedMs?: number
  loadMs?: number
  transferSize?: number
}

export type CaptureEvent = ConsoleEvent | PageErrorEvent | NetworkEvent | ActionEvent | ResourceEvent | PageEvent

export type Emit = (event: CaptureEvent) => void
export type Uninstall = () => void
