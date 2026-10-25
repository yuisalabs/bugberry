import { describe, expect, test } from "bun:test"
import { normalizePayload } from "../src/debugger-events"
import { environmentRows, maskedCount, visitedUrls } from "../src/info-view"

describe("visitedUrls", () => {
  test("lists the pages in time order from 0, each with the stretch of events it covers", () => {
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
      { atMs: 0, url: "https://shop.test/cart", reported: false, errors: 0, failedRequests: 0, from: null, to: 8000 },
      { atMs: 7000, url: "https://shop.test/checkout", reported: false, errors: 0, failedRequests: 0, from: 8000, to: 60_000 },
      { atMs: 59_000, url: "https://shop.test/thanks", reported: false, errors: 0, failedRequests: 0, from: 60_000, to: 70_000 },
      { atMs: 69_000, url: "https://shop.test/checkout", reported: true, errors: 0, failedRequests: 0, from: 70_000, to: null },
    ])
  })

  test("each page counts the errors and failed requests that happened while it was open", () => {
    const view = normalizePayload({
      recordingStartedAt: 1000,
      events: [
        { kind: "console", t: 1100, level: "error", text: "before the first page" },
        { kind: "action", t: 1200, type: "navigate", url: "https://shop.test/cart" },
        { kind: "console", t: 2000, level: "warn", text: "not an error" },
        { kind: "action", t: 8000, type: "navigate", url: "https://shop.test/checkout" },
        { kind: "error", t: 8500, message: "Cannot read properties of undefined" },
        { kind: "console", t: 8600, level: "error", text: "Payment failed" },
        { kind: "network", t: 8700, method: "POST", url: "https://shop.test/api/pay", status: 500 },
        { kind: "network", t: 8800, method: "GET", url: "https://shop.test/api/cart", status: 200 },
        { kind: "network", t: 8900, method: "GET", url: "https://shop.test/api/ping", status: null, failed: "net::ERR_FAILED" },
      ],
    })
    expect(visitedUrls(view, "https://shop.test/cart").map(({ errors, failedRequests }) => ({ errors, failedRequests }))).toEqual([
      { errors: 1, failedRequests: 0 },
      { errors: 2, failedRequests: 2 },
    ])
  })

  test("without navigations the report's page is the only one, with every event", () => {
    const view = normalizePayload({ events: [{ kind: "console", t: 5, level: "error", text: "Boom" }] })
    expect(visitedUrls(view, "https://shop.test/cart")).toEqual([
      { atMs: 0, url: "https://shop.test/cart", reported: true, errors: 1, failedRequests: 0, from: null, to: null },
    ])
    expect(visitedUrls(null, "https://shop.test/cart")).toEqual([
      { atMs: 0, url: "https://shop.test/cart", reported: true, errors: 0, failedRequests: 0, from: null, to: null },
    ])
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
