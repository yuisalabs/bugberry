import { describe, expect, test } from "bun:test"
import type { CaptureEvent, PageEvent, ResourceEvent } from "../src/events"
import { installResourceHooks, type ResourceHost } from "../src/hooks/resources"

type Entry = Record<string, unknown>

/** A PerformanceObserver the test feeds by hand. */
class FakeObserver {
  static last: FakeObserver | null = null
  options: unknown = null
  disconnected = false
  constructor(private readonly callback: (list: { getEntries(): Entry[] }) => void) {
    FakeObserver.last = this
  }
  observe(options: unknown) {
    this.options = options
  }
  disconnect() {
    this.disconnected = true
  }
  deliver(entries: Entry[]) {
    this.callback({ getEntries: () => entries })
  }
}

const resource = (overrides: Entry = {}): Entry => ({
  name: "https://shop.test/js/app.js",
  initiatorType: "script",
  startTime: 100,
  duration: 40,
  fetchStart: 101,
  domainLookupStart: 102,
  domainLookupEnd: 110,
  connectStart: 110,
  secureConnectionStart: 115,
  connectEnd: 120,
  requestStart: 121,
  responseStart: 131,
  responseEnd: 140,
  transferSize: 18_400,
  decodedBodySize: 52_000,
  ...overrides,
})

function setup(options: { readyState?: string; navigation?: Entry } = {}) {
  const events: CaptureEvent[] = []
  const listeners = new Map<string, () => void>()
  const timers: Array<() => void> = []
  const navigation: Entry = options.navigation ?? {
    type: "navigate",
    domContentLoadedEventEnd: 0,
    loadEventEnd: 0,
    transferSize: 0,
  }
  const host: ResourceHost = {
    performance: {
      timeOrigin: 1_000_000,
      getEntriesByType: (type: string) => (type === "navigation" ? [navigation as never] : []),
    },
    PerformanceObserver: FakeObserver as never,
    document: { readyState: options.readyState ?? "loading" },
    location: { href: "https://shop.test/checkout?token=secret" },
    addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
    setTimeout: (run: () => void) => void timers.push(run),
  }
  const uninstall = installResourceHooks(host, (event) => events.push(event))
  const resources = () => events.filter((event): event is ResourceEvent => event.kind === "resource")
  const page = () => events.find((event): event is PageEvent => event.kind === "page")
  return { events, listeners, timers, navigation, uninstall, resources, page }
}

describe("installResourceHooks", () => {
  test("buffered resource entries become resource events with type, size and timing", () => {
    const { resources } = setup()
    expect(FakeObserver.last?.options).toEqual({ type: "resource", buffered: true })
    FakeObserver.last?.deliver([resource()])
    expect(resources()).toEqual([
      {
        kind: "resource",
        t: 1_000_100,
        url: "https://shop.test/js/app.js",
        initiatorType: "script",
        durationMs: 40,
        transferSize: 18_400,
        decodedSize: 52_000,
        timing: { queueMs: 2, dnsMs: 8, connectMs: 5, tlsMs: 5, ttfbMs: 10, downloadMs: 9 },
      },
    ])
  })

  test("a cached entry is marked memory or disk", () => {
    const { resources } = setup()
    FakeObserver.last?.deliver([
      resource({ name: "https://shop.test/a.css", transferSize: 0, duration: 0 }),
      resource({ name: "https://shop.test/b.css", transferSize: 0, duration: 3 }),
    ])
    expect(resources().map((event) => event.cache)).toEqual(["memory", "disk"])
  })

  test("a cross-origin entry without timing keeps only url, type and duration", () => {
    const { resources } = setup()
    FakeObserver.last?.deliver([
      resource({
        name: "https://cdn.other.test/lib.js",
        transferSize: 0,
        decodedBodySize: 0,
        requestStart: 0,
        responseStart: 0,
        domainLookupStart: 0,
        domainLookupEnd: 0,
        connectStart: 0,
        connectEnd: 0,
        secureConnectionStart: 0,
      }),
    ])
    expect(resources()).toEqual([
      { kind: "resource", t: 1_000_100, url: "https://cdn.other.test/lib.js", initiatorType: "script", durationMs: 40 },
    ])
  })

  test("data, blob and extension URLs are skipped", () => {
    const { resources } = setup()
    FakeObserver.last?.deliver([
      resource({ name: "data:image/png;base64,AAAA" }),
      resource({ name: "blob:https://shop.test/1" }),
      resource({ name: "chrome-extension://abc/capture.js" }),
    ])
    expect(resources()).toEqual([])
  })

  test("the page event gets DOMContentLoaded and Load once loading ends", () => {
    const { page, listeners, timers, navigation } = setup()
    expect(page()).toEqual({ kind: "page", t: 1_000_000, url: "https://shop.test/checkout?token=[redacted]", via: "load" })
    Object.assign(navigation, { domContentLoadedEventEnd: 412.4, loadEventEnd: 890.6, transferSize: 18_600 })
    listeners.get("load")?.()
    for (const run of timers) run()
    expect(page()).toMatchObject({ domContentLoadedMs: 412, loadMs: 891, transferSize: 18_600 })
  })

  test("an already loaded page gets its timing right away", () => {
    const { page } = setup({
      readyState: "complete",
      navigation: { type: "navigate", domContentLoadedEventEnd: 300, loadEventEnd: 500, transferSize: 0 },
    })
    expect(page()).toMatchObject({ domContentLoadedMs: 300, loadMs: 500 })
  })

  test("a reload is recorded as via reload", () => {
    expect(setup({ navigation: { type: "reload", loadEventEnd: 0 } }).page()?.via).toBe("reload")
    expect(setup({ navigation: { type: "back_forward", loadEventEnd: 0 } }).page()?.via).toBe("back-forward")
    expect(setup({ navigation: { type: "prerender", loadEventEnd: 0 } }).page()?.via).toBe("load")
  })

  test("uninstall stops observing", () => {
    const { uninstall, resources } = setup()
    const observer = FakeObserver.last
    uninstall()
    expect(observer?.disconnected).toBe(true)
    observer?.deliver([resource()])
    expect(resources()).toEqual([])
  })
})
