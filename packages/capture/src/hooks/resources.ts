import type { Emit, PageEvent, ResourceEvent, ResourceTimingDetail, Uninstall } from "../events"
import { MAX_URL_CHARS } from "../limits"
import { safely } from "../safe"
import { redactUrl } from "../sanitize"

type TimingEntry = Record<string, unknown>

export interface ResourceHost {
  performance: { timeOrigin: number; getEntriesByType(type: string): unknown[] }
  PerformanceObserver?: new (callback: (list: { getEntries(): unknown[] }) => void) => {
    observe(options: { type: string; buffered: boolean }): void
    disconnect(): void
  }
  document: { readyState: string }
  location: { href: string }
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  setTimeout(run: () => void, ms: number): unknown
}

const SKIPPED = /^(?:data|blob|chrome-extension|moz-extension|safari-web-extension|about|javascript):/i

const num = (entry: TimingEntry, key: string): number => {
  const value = entry[key]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
const ms = (value: number) => Math.max(0, Math.round(value))

/** Phases of a request; absent when the browser hides them (cross-origin without Timing-Allow-Origin). */
function timingOf(entry: TimingEntry): ResourceTimingDetail | undefined {
  if (num(entry, "requestStart") <= 0 || num(entry, "responseStart") <= 0) return undefined
  const secure = num(entry, "secureConnectionStart")
  const tlsMs = secure > 0 ? ms(num(entry, "connectEnd") - secure) : 0
  const firstStep = num(entry, "domainLookupStart") || num(entry, "fetchStart")
  return {
    queueMs: ms(firstStep - num(entry, "startTime")),
    dnsMs: ms(num(entry, "domainLookupEnd") - num(entry, "domainLookupStart")),
    connectMs: ms(num(entry, "connectEnd") - num(entry, "connectStart") - tlsMs),
    tlsMs,
    ttfbMs: ms(num(entry, "responseStart") - num(entry, "requestStart")),
    downloadMs: ms(num(entry, "responseEnd") - num(entry, "responseStart")),
  }
}

export function resourceEvent(entry: TimingEntry, timeOrigin: number): ResourceEvent | null {
  const name = typeof entry.name === "string" ? entry.name : ""
  if (!name || SKIPPED.test(name)) return null
  const transferSize = num(entry, "transferSize")
  const decodedSize = num(entry, "decodedBodySize")
  const duration = num(entry, "duration")
  const timing = timingOf(entry)
  const cached = transferSize === 0 && decodedSize > 0
  return {
    kind: "resource",
    t: Math.round(timeOrigin + num(entry, "startTime")),
    url: redactUrl(name).slice(0, MAX_URL_CHARS),
    initiatorType: typeof entry.initiatorType === "string" ? entry.initiatorType.slice(0, 40) : "other",
    durationMs: ms(duration),
    ...(transferSize > 0 ? { transferSize } : {}),
    ...(decodedSize > 0 ? { decodedSize } : {}),
    ...(cached ? { cache: duration < 1 ? ("memory" as const) : ("disk" as const) } : {}),
    ...(timing ? { timing } : {}),
  }
}

function viaOf(type: unknown): PageEvent["via"] {
  if (type === "reload") return "reload"
  if (type === "back_forward") return "back-forward"
  return "load"
}

/**
 * Records every file the page loads from the browser's own timing records (no extra work per request),
 * and one page event with how the document was opened and when DOMContentLoaded and load ended.
 */
export function installResourceHooks(host: ResourceHost, emit: Emit): Uninstall {
  const performance = host.performance
  const navigation = (performance.getEntriesByType("navigation")[0] ?? {}) as TimingEntry
  const page: PageEvent = {
    kind: "page",
    t: Math.round(performance.timeOrigin),
    url: redactUrl(host.location.href).slice(0, MAX_URL_CHARS),
    via: viaOf(navigation.type),
  }
  emit(page)

  const fillTiming = () =>
    safely(() => {
      const entry = (performance.getEntriesByType("navigation")[0] ?? {}) as TimingEntry
      if (num(entry, "loadEventEnd") <= 0) return
      page.domContentLoadedMs = ms(num(entry, "domContentLoadedEventEnd"))
      page.loadMs = ms(num(entry, "loadEventEnd"))
      const transferSize = num(entry, "transferSize")
      if (transferSize > 0) page.transferSize = transferSize
    })
  // loadEventEnd is only set after every load handler has run.
  const onLoad = () => void host.setTimeout(fillTiming, 0)
  if (host.document.readyState === "complete") fillTiming()
  else host.addEventListener("load", onLoad)

  let stopped = false
  const Observer = host.PerformanceObserver
  const observer = Observer
    ? new Observer((list) =>
        safely(() => {
          if (stopped) return
          for (const entry of list.getEntries()) {
            const event = resourceEvent(entry as TimingEntry, performance.timeOrigin)
            if (event) emit(event)
          }
        }),
      )
    : null
  observer?.observe({ type: "resource", buffered: true })

  return () => {
    stopped = true
    observer?.disconnect()
    host.removeEventListener("load", onLoad)
  }
}
