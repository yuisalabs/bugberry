import { describe, expect, test } from "bun:test"
import type { CaptureEvent } from "@bugberry/capture"
import {
  applyPauses,
  errorsCaught,
  liveCounts,
  pauseMarks,
  reviewMarkers,
  reviewStats,
  suggestTitle,
  videoTime,
} from "../lib/review-data"

const click = (t: number): CaptureEvent => ({ kind: "action", t, type: "click", target: "button" })
const consoleError = (t: number, ...args: string[]): CaptureEvent => ({ kind: "console", t, level: "error", args })
const request = (t: number, url: string, extra: Partial<Extract<CaptureEvent, { kind: "network" }>> = {}): CaptureEvent => ({
  kind: "network",
  t,
  method: "POST",
  url,
  status: 200,
  ...extra,
})

describe("pauses", () => {
  const pause = { start: 5000, end: 8000 }

  test("events inside a pause are dropped and later ones move onto video time", () => {
    expect(applyPauses([click(2000), click(6000), click(9000)], 1000, [pause]).map((event) => event.t)).toEqual([2000, 6000])
  })

  test("events from before the start (an earlier take, before Restart) are dropped", () => {
    expect(applyPauses([click(500), click(2000)], 1000, []).map((event) => event.t)).toEqual([2000])
  })

  test("a pause still open drops everything after it began", () => {
    expect(applyPauses([click(2000), click(6000)], 1000, [{ start: 5000, end: Number.POSITIVE_INFINITY }]).map((event) => event.t)).toEqual([
      2000,
    ])
  })

  test("video time leaves out the paused part", () => {
    expect(videoTime(9000, 1000, [pause])).toBe(5000)
    expect(videoTime(6000, 1000, [pause])).toBe(4000)
    expect(pauseMarks(1000, [pause])).toEqual([{ atMs: 4000, ms: 3000 }])
  })
})

describe("suggestTitle", () => {
  test("a failed request comes first, even after a console error", () => {
    expect(suggestTitle([consoleError(5, "Oops"), request(9, "https://a.test/api/pay?x=1", { status: 500 })])).toEqual({
      title: "POST /api/pay failed (500)",
      from: "request",
    })
  })

  test("a request that never got an answer", () => {
    expect(suggestTitle([request(9, "https://a.test/x", { method: "GET", status: undefined, failed: "TypeError" })])).toEqual({
      title: "GET /x failed (network error)",
      from: "request",
    })
  })

  test("otherwise the first error", () => {
    expect(suggestTitle([{ kind: "error", t: 3, message: "TypeError: boom" }, consoleError(4, "later")])).toEqual({
      title: "TypeError: boom",
      from: "console",
    })
    expect(suggestTitle([consoleError(4, "Oops", "1")])).toEqual({ title: "Oops 1", from: "console" })
  })

  test("nothing went wrong, nothing to suggest; long messages are cut", () => {
    expect(suggestTitle([click(1), request(2, "https://a.test/ok")])).toBeNull()
    expect(suggestTitle([{ kind: "error", t: 3, message: "x".repeat(300) }])?.title).toHaveLength(200)
  })
})

describe("review numbers", () => {
  const events: CaptureEvent[] = [
    consoleError(1500, "a"),
    consoleError(1600, "b"),
    { kind: "error", t: 1700, message: "boom" },
    request(2000, "https://a.test/api/pay", { status: 500 }),
    request(2100, "https://a.test/api/x", { status: undefined, failed: "TypeError" }),
    ...Array.from({ length: 13 }, (_, index) => click(3000 + index)),
  ]

  test("errors, failed requests and steps", () => {
    expect(reviewStats(events)).toEqual({ errors: 3, failed: 2, steps: 13 })
  })

  test("markers like the dashboard's: status or xhr for requests, err for errors", () => {
    const markers = reviewMarkers(events, 1000)
    expect(markers.map((marker) => marker.label)).toEqual(["err", "err", "err", "500", "xhr"])
    expect(markers[3]).toMatchObject({ kind: "network", atMs: 1000, detail: "POST /api/pay → 500" })
  })

  test("errors caught since the start, without paused ones", () => {
    expect(errorsCaught(events, 1550, [])).toBe(4)
    expect(errorsCaught(events, 1000, [{ start: 1650, end: 2050 }])).toBe(3)
  })

  test("liveCounts splits errors, failed requests and actions", () => {
    const live: CaptureEvent[] = [
      consoleError(900, "before the start"),
      consoleError(1100, "a"),
      { kind: "error", t: 1200, message: "boom" },
      consoleError(1550, "paused"),
      request(1300, "https://a.test/api/pay", { status: 500 }),
      request(1400, "https://a.test/api/x", { status: undefined, failed: "TypeError" }),
      click(1600),
      click(1700),
      click(1800),
    ]
    expect(liveCounts(live, 1000, [{ start: 1500, end: 1560 }])).toEqual({ errors: 2, failedRequests: 2, actions: 3 })
  })
})
