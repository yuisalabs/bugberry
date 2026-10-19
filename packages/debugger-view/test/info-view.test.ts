import { describe, expect, test } from "bun:test"
import { normalizePayload } from "../src/debugger-events"
import { environmentRows, maskedCount, visitedUrls } from "../src/info-view"

describe("visitedUrls", () => {
  test("lists the pages in time order from 0, marking where the bug was reported", () => {
    const view = normalizePayload({
      recordingStartedAt: 1000,
      events: [
        { kind: "action", t: 1200, type: "navigate", url: "https://shop.test/cart" },
        { kind: "action", t: 8000, type: "navigate", url: "https://shop.test/checkout" },
        { kind: "action", t: 9000, type: "navigate", url: "https://shop.test/checkout" },
        { kind: "action", t: 60_000, type: "navigate", url: "https://shop.test/thanks" },
        { kind: "action", t: 70_000, type: "navigate", url: "https://shop.test/checkout" },
      ],
    })
    expect(visitedUrls(view, "https://shop.test/checkout")).toEqual([
      { atMs: 0, url: "https://shop.test/cart", bugHere: false },
      { atMs: 7000, url: "https://shop.test/checkout", bugHere: false },
      { atMs: 59_000, url: "https://shop.test/thanks", bugHere: false },
      { atMs: 69_000, url: "https://shop.test/checkout", bugHere: true },
    ])
  })

  test("without navigations the report's page is the only one", () => {
    expect(visitedUrls(normalizePayload({ events: [] }), "https://shop.test/cart")).toEqual([
      { atMs: 0, url: "https://shop.test/cart", bugHere: true },
    ])
    expect(visitedUrls(null, "https://shop.test/cart")).toEqual([{ atMs: 0, url: "https://shop.test/cart", bugHere: true }])
  })

  test("a screenshot counts from its first navigation", () => {
    const view = normalizePayload({
      capturedAt: 50_000,
      events: [
        { kind: "action", t: 10_000, type: "navigate", url: "https://shop.test/a" },
        { kind: "action", t: 12_500, type: "navigate", url: "https://shop.test/b" },
      ],
    })
    expect(visitedUrls(view, "https://shop.test/b").map((entry) => entry.atMs)).toEqual([0, 2500])
  })
})

describe("maskedCount", () => {
  test("counts inputs whose value was masked", () => {
    const view = normalizePayload({
      events: [
        { kind: "action", t: 1, type: "input", target: "input#card", value: "••••" },
        { kind: "action", t: 2, type: "input", target: "input#email", value: "dana@acme.io" },
        { kind: "action", t: 3, type: "input", target: "input#cvc", value: "•••" },
      ],
    })
    expect(maskedCount(view)).toBe(2)
    expect(maskedCount(null)).toBe(0)
  })
})

describe("environmentRows", () => {
  const device = { browser: "Chrome 131", os: "macOS", viewport: "1440x900" }

  test("the full environment, as in the design", () => {
    const view = normalizePayload({
      environment: {
        language: "id-ID",
        timeZone: "Asia/Jakarta",
        pixelRatio: 2,
        connection: { effectiveType: "4g", downlinkMbps: 10, rttMs: 38 },
        browserVersion: "Chrome 131.0.6778.86",
        osVersion: "macOS 15.2",
      },
      events: [],
    })
    expect(environmentRows(view, device)).toEqual([
      { label: "OS", value: "macOS 15.2" },
      { label: "Browser", value: "Chrome 131.0.6778.86" },
      { label: "Window size", value: "1440 × 900 at 2× pixel ratio" },
      { label: "Network speed", value: "4G, 10 Mbps, 38 ms latency", tag: "Fast" },
      { label: "Language", value: "id-ID, timezone Asia/Jakarta" },
    ])
  })

  test("a slow or partial environment shows what it has", () => {
    const view = normalizePayload({ environment: { connection: { effectiveType: "3g" }, timeZone: "Europe/London" }, events: [] })
    expect(environmentRows(view, device)).toEqual([
      { label: "OS", value: "macOS" },
      { label: "Browser", value: "Chrome 131" },
      { label: "Window size", value: "1440 × 900" },
      { label: "Network speed", value: "3G", tag: "Slow" },
      { label: "Language", value: "timezone Europe/London" },
    ])
  })

  test("an old report falls back to the device it recorded", () => {
    expect(environmentRows(null, device)).toEqual([
      { label: "OS", value: "macOS" },
      { label: "Browser", value: "Chrome 131" },
      { label: "Window size", value: "1440 × 900" },
    ])
  })
})
