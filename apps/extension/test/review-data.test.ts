import { describe, expect, test } from "bun:test"
import type { CaptureEvent, DebuggerPayload } from "@bugberry/capture"
import {
  applyPauses,
  clampTrim,
  errorsCaught,
  isTrimmed,
  liveCounts,
  pauseMarks,
  reviewMarkers,
  reviewStats,
  suggestTitle,
  trimLabel,
  trimPayload,
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

describe("trim", () => {
  const payload: DebuggerPayload = {
    version: 1,
    capturedAt: 0,
    recordingStartedAt: 1000,
    incomplete: [],
    events: [
      { kind: "action", t: 1000 + 5_999, type: "click", target: "a" },
      { kind: "action", t: 1000 + 6_000, type: "click", target: "b" },
      { kind: "error", t: 1000 + 35_000, message: "boom" },
      { kind: "error", t: 1000 + 35_001, message: "late" },
    ],
    notes: [
      { n: 1, atMs: 3_000, text: "x", author: "D" },
      { n: 2, atMs: 10_000, text: "y", author: "D" },
    ],
    pauses: [{ atMs: 20_000, ms: 4_000 }],
  }
  const range = { startMs: 6_000, endMs: 35_000 }

  test("keeps the events inside the range, boundaries included, and moves the start", () => {
    const cut = trimPayload(payload, 1000, range)
    expect(cut.events.map((event) => event.t)).toEqual([7_000, 36_000])
    expect(cut.recordingStartedAt).toBe(7_000)
  })

  test("shifts notes and pauses into the new video time", () => {
    const cut = trimPayload(payload, 1000, range)
    expect(cut.notes).toEqual([{ n: 2, atMs: 4_000, text: "y", author: "D" }])
    expect(cut.pauses).toEqual([{ atMs: 14_000, ms: 4_000 }])
  })

  test("a payload without notes or pauses stays without them", () => {
    const { notes: _notes, pauses: _pauses, ...bare } = payload
    const cut = trimPayload(bare, 1000, range)
    expect("notes" in cut).toBe(false)
    expect("pauses" in cut).toBe(false)
  })

  test("markers and tiles of the cut payload count only the range", () => {
    const cut = trimPayload(payload, 1000, range)
    expect(reviewStats(cut.events)).toEqual({ errors: 1, failed: 0, steps: 1 })
    expect(reviewMarkers(cut.events, cut.recordingStartedAt ?? 0).map((marker) => marker.atMs)).toEqual([29_000])
  })

  test("clampTrim keeps a range of at least a second inside the video", () => {
    expect(clampTrim({ startMs: -5, endMs: 50_000 }, 42_000)).toEqual({ startMs: 0, endMs: 42_000 })
    expect(clampTrim({ startMs: 10_000, endMs: 10_200 }, 42_000)).toEqual({ startMs: 10_000, endMs: 11_000 })
    expect(clampTrim({ startMs: 41_800, endMs: 42_000 }, 42_000)).toEqual({ startMs: 41_000, endMs: 42_000 })
  })

  test("isTrimmed is false for no range and for the whole video", () => {
    expect(isTrimmed(null, 42_000)).toBe(false)
    expect(isTrimmed({ startMs: 0, endMs: 42_000 }, 42_000)).toBe(false)
    expect(isTrimmed({ startMs: 0, endMs: 41_000 }, 42_000)).toBe(true)
  })

  test("trimLabel reads like the button", () => {
    expect(trimLabel(range)).toBe("0:06–0:35")
  })
})
