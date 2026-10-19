import { describe, expect, test } from "bun:test"
import {
  consoleEntries,
  filterNetwork,
  MAX_EVENTS,
  MAX_TEXT,
  normalizePayload,
  type ViewNetwork,
} from "../src/debugger-events"

describe("normalizePayload", () => {
  test("trusts only kind and t; coerces or drops everything else", () => {
    const view = normalizePayload({
      version: 1,
      capturedAt: 1000,
      recordingStartedAt: "soon",
      incomplete: ["fetch", 5],
      events: [
        { kind: "console", t: 900, level: "warn", args: ["a", 1, { x: 1 }] },
        { kind: "console", t: 950, level: "<script>", args: "nope" },
        { kind: "error", t: 920, message: "<img src=x onerror=alert(1)>" },
        { kind: "network", t: 910, method: "post", url: "https://api.test/x", status: 500, requestHeaders: { a: "b", c: 3 }, responseHeaders: ["bad"] },
        { kind: "action", t: 905, type: "teleport", target: "button#pay" },
        { kind: "bogus", t: 1 },
        { kind: "console", t: "soon" },
        { kind: "console", t: Number.POSITIVE_INFINITY },
        null,
        "x",
      ],
    })
    expect(view.capturedAt).toBe(1000)
    expect(view.recordingStartedAt).toBeNull()
    expect(view.incomplete).toEqual(["fetch"])
    expect(view.events.map((event) => event.kind)).toEqual(["console", "action", "network", "error", "console"])
    expect(view.events[0]).toEqual({ kind: "console", t: 900, level: "warn", text: "a 1", stack: null, source: null })
    expect(view.events[4]).toMatchObject({ level: "log", text: "" })
    expect(view.events[1]).toMatchObject({ type: "other", target: "button#pay" })
    expect(view.events[2]).toMatchObject({
      method: "POST",
      status: 500,
      requestHeaders: [["a", "b"], ["c", "3"]],
      responseHeaders: [],
      failed: null,
    })
    expect(view.events[3]).toMatchObject({ message: "<img src=x onerror=alert(1)>" })
  })

  test("caps huge strings and event counts", () => {
    const view = normalizePayload({
      events: [
        { kind: "console", t: 1, level: "log", args: ["x".repeat(MAX_TEXT * 2)] },
        ...Array.from({ length: MAX_EVENTS + 10 }, (_, index) => ({ kind: "action", t: 10 + index, type: "click" })),
      ],
    })
    expect(view.events).toHaveLength(MAX_EVENTS)
    expect(view.events[0]?.t).toBe(20)
    const [big] = normalizePayload({ events: [{ kind: "console", t: 1, level: "log", args: ["x".repeat(MAX_TEXT * 2)] }] }).events
    expect(big?.kind === "console" ? big.text.length : 0).toBe(MAX_TEXT + 1)
  })

  test("garbage payloads become an empty view", () => {
    expect(normalizePayload(null)).toEqual({
      capturedAt: null,
      recordingStartedAt: null,
      incomplete: [],
      events: [],
      environment: null,
      notes: [],
      pauses: [],
    })
    expect(normalizePayload({ events: "nope" }).events).toEqual([])
  })
})

describe("the richer capture data", () => {
  const view = normalizePayload({
    version: 1,
    capturedAt: 5000,
    recordingStartedAt: 1000,
    incomplete: [],
    environment: {
      language: "id-ID",
      timeZone: "Asia/Jakarta",
      pixelRatio: 2,
      connection: { effectiveType: "4g", downlinkMbps: 10, rttMs: 38 },
      browserVersion: "Chrome 131.0.6778.86",
      osVersion: "macOS 15.2",
    },
    events: [
      { kind: "page", t: 1000, url: "https://shop.test/checkout", via: "reload", domContentLoadedMs: 412, loadMs: 891, transferSize: 18_600 },
      {
        kind: "resource",
        t: 1100,
        url: "https://shop.test/app.js",
        initiatorType: "script",
        durationMs: 40,
        transferSize: 18_400,
        decodedSize: 52_000,
        cache: "disk",
        timing: { queueMs: 2, dnsMs: 8, connectMs: 5, tlsMs: 5, ttfbMs: 10, downloadMs: 9 },
      },
      { kind: "console", t: 1200, level: "log", args: ["added"], source: "cart.js:88" },
      { kind: "network", t: 1300, method: "POST", url: "https://shop.test/api/orders", status: 500, initiator: "api.js:41" },
      { kind: "action", t: 1400, type: "navigate", url: "https://shop.test/pay", via: "history" },
      { kind: "action", t: 1500, type: "rage-click", target: "button#pay", value: "4" },
      { kind: "action", t: 1600, type: "visibility", value: "hidden" },
    ],
  })
  const find = <K extends string>(kind: K) => view.events.filter((event) => event.kind === kind)

  test("each new kind and field is read", () => {
    expect(find("page")[0]).toEqual({
      kind: "page",
      t: 1000,
      url: "https://shop.test/checkout",
      via: "reload",
      domContentLoadedMs: 412,
      loadMs: 891,
      transferSize: 18_600,
    })
    expect(find("resource")[0]).toEqual({
      kind: "resource",
      t: 1100,
      url: "https://shop.test/app.js",
      initiatorType: "script",
      durationMs: 40,
      transferSize: 18_400,
      decodedSize: 52_000,
      cache: "disk",
      timing: { queueMs: 2, dnsMs: 8, connectMs: 5, tlsMs: 5, ttfbMs: 10, downloadMs: 9 },
    })
    expect(find("console")[0]).toMatchObject({ source: "cart.js:88" })
    expect(find("network")[0]).toMatchObject({ initiator: "api.js:41" })
    expect(find("action").map((event) => [event.kind === "action" && event.type, event.kind === "action" && event.via])).toEqual([
      ["navigate", "history"],
      ["rage-click", null],
      ["visibility", null],
    ])
    expect(view.environment).toEqual({
      language: "id-ID",
      timeZone: "Asia/Jakarta",
      pixelRatio: 2,
      connection: { effectiveType: "4g", downlinkMbps: 10, rttMs: 38 },
      browserVersion: "Chrome 131.0.6778.86",
      osVersion: "macOS 15.2",
    })
  })

  test("hostile values are dropped or nulled", () => {
    const hostile = normalizePayload({
      environment: { language: { evil: true }, pixelRatio: "2", connection: { downlinkMbps: -1 } },
      events: [
        { kind: "resource", t: 1, url: "https://x.test/a", initiatorType: "img", transferSize: -5, decodedSize: 1e12, cache: "ram", timing: { dnsMs: "fast" } },
        { kind: "page", t: 2, url: "https://x.test/", via: "teleport", loadMs: -1 },
        { kind: "network", t: 3, method: "GET", url: "https://x.test/b", initiator: "x".repeat(1_000_000) },
        { kind: "action", t: 4, type: "navigate", via: "teleport" },
      ],
    })
    const [resource, page, network, action] = hostile.events
    expect(resource).toMatchObject({ transferSize: null, decodedSize: null, cache: null, timing: null })
    expect(page).toMatchObject({ via: "load", loadMs: null })
    expect(network?.kind === "network" ? network.initiator?.length : 0).toBeLessThanOrEqual(200)
    expect(action).toMatchObject({ via: null })
    expect(hostile.environment).toEqual({
      language: null,
      timeZone: null,
      pixelRatio: null,
      connection: null,
      browserVersion: null,
      osVersion: null,
    })
  })

  test("an old payload has no environment and no resources", () => {
    const old = normalizePayload({
      version: 1,
      capturedAt: 10,
      recordingStartedAt: null,
      incomplete: [],
      events: [{ kind: "console", t: 1, level: "log", args: ["hi"] }],
    })
    expect(old.environment).toBeNull()
    expect(old.events.map((event) => event.kind)).toEqual(["console"])
    expect(old.events[0]).toMatchObject({ source: null })
  })
})

describe("console and network filters", () => {
  const { events } = normalizePayload({
    events: [
      { kind: "console", t: 1, level: "log", args: ["hello"] },
      { kind: "console", t: 2, level: "warn", args: ["careful"] },
      { kind: "error", t: 3, message: "boom", source: "app.js:10" },
      { kind: "network", t: 4, method: "GET", url: "https://app.test/api/user", status: 200 },
      { kind: "network", t: 5, method: "POST", url: "https://app.test/api/pay", status: 502 },
      { kind: "network", t: 6, method: "GET", url: "https://app.test/api/cart", failed: "TypeError: Failed to fetch" },
    ],
  })

  test("uncaught errors count as console errors", () => {
    const entries = consoleEntries(events)
    expect(entries.map((entry) => [entry.level, entry.text, entry.uncaught])).toEqual([
      ["log", "hello", false],
      ["warn", "careful", false],
      ["error", "boom (app.js:10)", true],
    ])
  })

  test("failed means status >= 400 or a network error; search matches the URL", () => {
    const urls = (list: ViewNetwork[]) => list.map((event) => event.url)
    expect(urls(filterNetwork(events, { failedOnly: true, query: "" }))).toEqual([
      "https://app.test/api/pay",
      "https://app.test/api/cart",
    ])
    expect(urls(filterNetwork(events, { failedOnly: false, query: " USER " }))).toEqual(["https://app.test/api/user"])
  })
})

describe("recording notes and pauses", () => {
  test("well-formed notes and pauses are kept, the rest dropped", () => {
    const view = normalizePayload({
      notes: [{ n: 1, atMs: 31_000, text: "Spins forever", author: "Dana" }, { n: "x" }],
      pauses: [{ atMs: 42_000, ms: 33_000 }, { atMs: -1 }],
      events: [],
    })
    expect(view.notes).toEqual([{ n: 1, atMs: 31_000, text: "Spins forever", author: "Dana" }])
    expect(view.pauses).toEqual([{ atMs: 42_000, ms: 33_000 }])
  })

  test("an older payload has neither", () => {
    expect(normalizePayload({ events: [] })).toMatchObject({ notes: [], pauses: [] })
  })
})
