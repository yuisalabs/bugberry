import { describe, expect, test } from "bun:test"
import type { ViewEvent, ViewNetwork, ViewPage, ViewResource } from "../src/debugger-events"
import {
  formatBytes,
  matchesFilter,
  networkRows,
  networkTotals,
  rowType,
  sizeLabel,
  TYPE_FILTERS,
  waterfall,
} from "../src/network-view"

const request = (overrides: Partial<ViewNetwork> = {}): ViewNetwork => ({
  kind: "network",
  t: 1000,
  method: "POST",
  url: "https://shop.test/api/orders",
  status: 500,
  durationMs: 120,
  requestHeaders: [],
  responseHeaders: [],
  requestBody: null,
  responseBody: null,
  failed: null,
  pending: false,
  initiator: "api.js:41",
  ...overrides,
})

const resource = (overrides: Partial<ViewResource> = {}): ViewResource => ({
  kind: "resource",
  t: 1010,
  url: "https://shop.test/api/orders",
  initiatorType: "fetch",
  durationMs: 118,
  transferSize: 312,
  decodedSize: 120,
  cache: null,
  timing: { queueMs: 1, dnsMs: 0, connectMs: 0, tlsMs: 0, ttfbMs: 100, downloadMs: 17 },
  ...overrides,
})

const page = (overrides: Partial<ViewPage> = {}): ViewPage => ({
  kind: "page",
  t: 900,
  url: "https://shop.test/checkout",
  via: "load",
  domContentLoadedMs: 412,
  loadMs: 890,
  transferSize: 18_600,
  ...overrides,
})

describe("networkRows", () => {
  test("a fetch and its resource entry become one row with size and timing", () => {
    const rows = networkRows([request(), resource()])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: "fetch", method: "POST", status: 500, url: "https://shop.test/api/orders" })
    expect(rows[0]?.request?.initiator).toBe("api.js:41")
    expect(rows[0]?.resource?.transferSize).toBe(312)
  })

  test("a resource far from the request in time, or for another URL, stays its own row", () => {
    const rows = networkRows([request(), resource({ t: 1500 }), resource({ url: "https://shop.test/api/cart" })])
    expect(rows).toHaveLength(3)
  })

  test("pages are document rows and everything is in time order", () => {
    const events: ViewEvent[] = [resource({ t: 1200, url: "https://shop.test/app.js", initiatorType: "script" }), page()]
    expect(networkRows(events).map((row) => [row.type, row.t])).toEqual([
      ["document", 900],
      ["script", 1200],
    ])
  })
})

describe("rowType", () => {
  test("from the browser's initiator type, then the file extension", () => {
    expect(rowType("xmlhttprequest", "https://a.test/x")).toBe("xhr")
    expect(rowType("fetch", "https://a.test/x")).toBe("fetch")
    expect(rowType("script", "https://a.test/app")).toBe("script")
    expect(rowType("link", "https://a.test/site.css?v=2")).toBe("stylesheet")
    expect(rowType("css", "https://a.test/font.woff2")).toBe("font")
    expect(rowType("css", "https://a.test/bg.webp")).toBe("img")
    expect(rowType("img", "https://a.test/pixel")).toBe("img")
    expect(rowType("video", "https://a.test/clip")).toBe("media")
    expect(rowType("websocket", "wss://a.test/live")).toBe("websocket")
    expect(rowType("beacon", "https://a.test/collect")).toBe("other")
  })
})

describe("matchesFilter", () => {
  test("each filter picks its types", () => {
    const rows = networkRows([
      page(),
      request({ t: 2000, url: "https://shop.test/api/a" }),
      resource({ t: 3000, url: "https://shop.test/app.js", initiatorType: "script" }),
      resource({ t: 4000, url: "https://shop.test/site.css", initiatorType: "link" }),
      resource({ t: 5000, url: "https://shop.test/logo.png", initiatorType: "img" }),
      resource({ t: 6000, url: "https://shop.test/a.woff2", initiatorType: "css" }),
      resource({ t: 7000, url: "wss://shop.test/live", initiatorType: "websocket" }),
    ])
    const picked = (filter: (typeof TYPE_FILTERS)[number]) => rows.filter((row) => matchesFilter(row, filter)).map((row) => row.type)
    expect(TYPE_FILTERS).toEqual(["All", "Fetch/XHR", "WS", "JS", "CSS", "Doc", "Media", "Other"])
    expect(picked("All")).toHaveLength(7)
    expect(picked("Fetch/XHR")).toEqual(["fetch"])
    expect(picked("WS")).toEqual(["websocket"])
    expect(picked("JS")).toEqual(["script"])
    expect(picked("CSS")).toEqual(["stylesheet"])
    expect(picked("Doc")).toEqual(["document"])
    expect(picked("Media")).toEqual(["img"])
    expect(picked("Other")).toEqual(["font"])
  })
})

describe("sizes", () => {
  test("cache hits say so; bytes read like Chrome", () => {
    const [memory] = networkRows([resource({ cache: "memory", transferSize: null })])
    const [disk] = networkRows([resource({ cache: "disk", transferSize: null })])
    const [bytes] = networkRows([resource({ transferSize: 18_400 })])
    expect(memory && sizeLabel(memory)).toBe("(memory cache)")
    expect(disk && sizeLabel(disk)).toBe("(disk cache)")
    expect(bytes && sizeLabel(bytes)).toBe("18.4 kB")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1_400_000)).toBe("1.4 MB")
  })

  test("a resource without timing details", () => {
    const [row] = networkRows([
      resource({ url: "https://cdn.other.test/lib.js", initiatorType: "script", transferSize: null, decodedSize: null, timing: null }),
    ])
    expect(row && sizeLabel(row)).toBe("")
    expect(row?.resource?.timing).toBeNull()
    const bars = row ? waterfall([row]) : new Map()
    expect(bars.get(row?.key ?? "")).toEqual({ leftPercent: 0, widthPercent: 100 })
  })
})

describe("waterfall", () => {
  test("places each row along the whole span", () => {
    const rows = networkRows([
      resource({ t: 1000, durationMs: 100, url: "https://a.test/1.js", initiatorType: "script" }),
      resource({ t: 1100, durationMs: 100, url: "https://a.test/2.js", initiatorType: "script" }),
      resource({ t: 1300, durationMs: 0, url: "https://a.test/3.js", initiatorType: "script" }),
    ])
    const bars = waterfall(rows)
    const rounded = rows.map((row) => {
      const bar = bars.get(row.key)
      return bar && [Number(bar.leftPercent.toFixed(2)), Number(bar.widthPercent.toFixed(2))]
    })
    expect(rounded).toEqual([
      [0, 33.33],
      [33.33, 33.33],
      [100, 0.5],
    ])
  })
})

describe("networkTotals", () => {
  test("adds up transfers, resources and the latest page's load times", () => {
    const totals = networkTotals([
      page(),
      resource({ t: 1000, durationMs: 100, transferSize: 1000, decodedSize: 3000, url: "https://a.test/a.js", initiatorType: "script" }),
      page({ t: 5000, domContentLoadedMs: 300, loadMs: 600, transferSize: 2000 }),
      resource({ t: 5100, durationMs: 400, transferSize: 500, decodedSize: 700, url: "https://a.test/b.js", initiatorType: "script" }),
    ])
    expect(totals).toEqual({ transferredBytes: 22_100, resourceBytes: 3700, finishMs: 4700, domContentLoadedMs: 300, loadMs: 600 })
  })

  test("nothing recorded gives nothing", () => {
    expect(networkTotals([])).toEqual({ transferredBytes: 0, resourceBytes: 0, finishMs: null, domContentLoadedMs: null, loadMs: null })
  })
})
