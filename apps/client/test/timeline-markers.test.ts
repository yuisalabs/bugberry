import { describe, expect, test } from "bun:test"
import type { DebuggerView, ViewEvent } from "../src/lib/debugger-events"
import { timelineMarkers } from "../src/lib/timeline-markers"
import { shareUrlAt } from "../src/lib/urls"

const network = (t: number, changes: Partial<Extract<ViewEvent, { kind: "network" }>> = {}): ViewEvent => ({
  kind: "network",
  t,
  method: "POST",
  url: "https://shop.test/api/orders?id=1",
  status: 200,
  durationMs: 12,
  requestHeaders: [],
  responseHeaders: [],
  requestBody: null,
  responseBody: null,
  failed: null,
  pending: false,
  initiator: null,
  ...changes,
})

const view = (events: ViewEvent[], extra: Partial<DebuggerView> = {}): DebuggerView => ({
  capturedAt: null,
  recordingStartedAt: 1_000,
  incomplete: [],
  events,
  environment: null,
  notes: [],
  pauses: [],
  ...extra,
})

describe("timelineMarkers", () => {
  test("failed requests show their status, network errors show xhr, errors show err", () => {
    const markers = timelineMarkers(
      view([
        network(2_000),
        network(3_000, { status: 503 }),
        network(4_000, { status: null, failed: "net::ERR_CONNECTION_REFUSED" }),
        { kind: "console", t: 5_000, level: "error", text: "boom", stack: null, source: null },
        { kind: "console", t: 5_500, level: "warn", text: "careful", stack: null, source: null },
        { kind: "error", t: 6_000, message: "TypeError: x is undefined", stack: null, source: null },
        { kind: "action", t: 6_500, type: "click", target: "#pay", value: null, url: null, via: null },
      ]),
    )
    expect(markers.map(({ atMs, kind, label, detail }) => ({ atMs, kind, label, detail }))).toEqual([
      { atMs: 2_000, kind: "network", label: "503", detail: "POST /api/orders?id=1 → 503" },
      { atMs: 3_000, kind: "network", label: "xhr", detail: "POST /api/orders?id=1 failed: net::ERR_CONNECTION_REFUSED" },
      { atMs: 4_000, kind: "error", label: "err", detail: "boom" },
      { atMs: 5_000, kind: "error", label: "err", detail: "TypeError: x is undefined" },
    ])
    expect(new Set(markers.map((marker) => marker.id)).size).toBe(markers.length)
  })

  test("no recording start, no markers", () => {
    expect(timelineMarkers(view([network(2_000, { status: 500 })], { recordingStartedAt: null }))).toEqual([])
  })
})

describe("shareUrlAt", () => {
  test("the share link opens at that second", () => {
    expect(shareUrlAt("AbC", 3.7, "https://bugberry.test")).toBe("https://bugberry.test/s/AbC?t=3")
    expect(shareUrlAt("AbC", 0, "https://bugberry.test")).toBe("https://bugberry.test/s/AbC")
  })
})

test("notes and pauses are marked at their video time", () => {
  const markers = timelineMarkers(
    view([], { notes: [{ n: 1, atMs: 31_000, text: "Spins forever", author: "Dana" }], pauses: [{ atMs: 42_000, ms: 33_000 }] }),
  )
  expect(markers).toEqual([
    { id: "note-1", atMs: 31_000, kind: "note", label: "1", detail: "Spins forever" },
    { id: "pause-0", atMs: 42_000, kind: "pause", label: "⏸", detail: "Paused at 0:42 · 33s" },
  ])
})
