import { describe, expect, test } from "bun:test"
import { normalizePayload } from "../src/lib/debugger-events"
import { consoleCounts, consoleRows, navigationText } from "../src/lib/console-view"

const { events } = normalizePayload({
  events: [
    { kind: "action", t: 1000, type: "navigate", url: "https://shop.test/cart" },
    { kind: "console", t: 1100, level: "log", args: ["[cart] restored"] },
    { kind: "action", t: 1200, type: "click", target: "button#pay" },
    { kind: "network", t: 1300, method: "POST", url: "https://shop.test/api/orders", status: 500 },
    { kind: "network", t: 1350, method: "GET", url: "https://shop.test/api/ok", status: 200 },
    { kind: "error", t: 1400, message: "TypeError: sku", stack: "at submit (checkout.js:1)" },
    { kind: "console", t: 1500, level: "warn", args: ["careful"] },
    { kind: "console", t: 1600, level: "info", args: ["fyi"] },
    { kind: "network", t: 1700, method: "GET", url: "https://shop.test/api/cart", failed: "TypeError: Failed to fetch" },
  ],
})
const defaults = { level: "all" as const, query: "", navigations: true, networkErrors: true, activity: false }
const kinds = (rows: ReturnType<typeof consoleRows>) => rows.map((row) => row.kind)

describe("consoleRows", () => {
  test("logs, navigations and network errors in time order; activity off by default", () => {
    const rows = consoleRows(events, defaults)
    expect(kinds(rows)).toEqual(["navigation", "log", "network-error", "log", "log", "log", "network-error"])
    expect(rows[2]).toEqual({ t: 1300, kind: "network-error", text: "POST https://shop.test/api/orders 500" })
    expect(rows[6]).toEqual({ t: 1700, kind: "network-error", text: "GET https://shop.test/api/cart failed" })
    expect(rows[3]).toMatchObject({ kind: "log", level: "error", uncaught: true, stack: "at submit (checkout.js:1)" })
  })

  test("each toggle adds or removes its rows", () => {
    expect(kinds(consoleRows(events, { ...defaults, navigations: false }))).not.toContain("navigation")
    expect(kinds(consoleRows(events, { ...defaults, networkErrors: false }))).not.toContain("network-error")
    const withActivity = consoleRows(events, { ...defaults, activity: true })
    expect(withActivity.find((row) => row.kind === "activity")).toEqual({ t: 1200, kind: "activity", text: "Clicked button#pay" })
  })

  test("the level filter keeps only that level's logs", () => {
    const rows = consoleRows(events, { ...defaults, level: "warn", navigations: false, networkErrors: false })
    expect(rows).toEqual([{ t: 1500, kind: "log", level: "warn", text: "careful", stack: null, uncaught: false, source: null }])
  })

  test("the query filter matches any row's text, ignoring case", () => {
    const rows = consoleRows(events, { ...defaults, query: "ORDERS" })
    expect(kinds(rows)).toEqual(["network-error"])
  })
})

describe("consoleCounts", () => {
  test("counts errors, warnings and info", () => {
    expect(consoleCounts(events)).toEqual({ errors: 1, warnings: 1, info: 2 })
  })
})

describe("recording markers, sources and how a page was reached", () => {
  const { events: richer } = normalizePayload({
    events: [
      { kind: "action", t: 1000, type: "navigate", url: "https://shop.test/cart", via: "load" },
      { kind: "console", t: 1100, level: "log", args: ["restored"], source: "cart.js:88" },
      { kind: "action", t: 2000, type: "navigate", url: "https://shop.test/pay", via: "history" },
      { kind: "action", t: 3000, type: "navigate", url: "https://shop.test/pay?retry=1", via: "reload" },
      { kind: "action", t: 4000, type: "navigate", url: "https://shop.test/cart", via: "back-forward" },
      { kind: "action", t: 5000, type: "navigate", url: "https://shop.test/cart#top" },
    ],
  })

  test("a recording starts and stops in the timeline; without a duration it only starts", () => {
    const rows = consoleRows(richer, defaults, { startedAt: 900, durationMs: 5000 })
    expect(rows[0]).toEqual({ t: 900, kind: "marker", text: "Recording started" })
    expect(rows.at(-1)).toEqual({ t: 5900, kind: "marker", text: "Recording stopped" })
    const open = consoleRows(richer, defaults, { startedAt: 900, durationMs: null })
    expect(open.filter((row) => row.kind === "marker").map((row) => row.kind === "marker" && row.text)).toEqual(["Recording started"])
    expect(consoleRows(richer, defaults).some((row) => row.kind === "marker")).toBe(false)
  })

  test("log rows carry the line of code that made them", () => {
    expect(consoleRows(richer, defaults).find((row) => row.kind === "log")).toMatchObject({ source: "cart.js:88" })
  })

  test("navigation rows say how the page was reached", () => {
    const texts = consoleRows(richer, defaults)
      .filter((row) => row.kind === "navigation")
      .map((row) => row.kind === "navigation" && navigationText(row))
    expect(texts).toEqual([
      "Navigated to https://shop.test/cart on page load",
      "Navigated to https://shop.test/pay via History API",
      "Navigated to https://shop.test/pay?retry=1 via a page reload",
      "Navigated to https://shop.test/cart via back/forward",
      "Navigated to https://shop.test/cart#top",
    ])
  })
})
