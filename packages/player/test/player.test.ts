import { describe, expect, test } from "bun:test"
import { displayDuration, formatClock, hotkeyAction, markerLabel, PLAYBACK_RATES, placeMarkers, seekTarget } from "../src"

describe("markerLabel", () => {
  const marker = (id: string) => ({ id, atMs: 1000, kind: "error" as const, label: "err", detail: "boom" })

  test("one marker shows its own label; a group shows how many", () => {
    expect(markerLabel({ leftPercent: 10, markers: [marker("a")] })).toBe("err")
    expect(markerLabel({ leftPercent: 10, markers: [marker("a"), marker("b"), marker("c")] })).toBe("×3")
  })
})

describe("displayDuration", () => {
  test("the file's own duration when it has one", () => {
    expect(displayDuration(12.5, 99_000)).toBe(12.5)
  })

  test("the recorded duration when the file has none (MediaRecorder WebM)", () => {
    expect(displayDuration(Number.POSITIVE_INFINITY, 42_000)).toBe(42)
    expect(displayDuration(Number.NaN, 42_000)).toBe(42)
    expect(displayDuration(0, 42_000)).toBe(42)
  })

  test("nothing to show when neither is known", () => {
    expect(displayDuration(Number.NaN, null)).toBeNull()
    expect(displayDuration(Number.POSITIVE_INFINITY, undefined)).toBeNull()
  })
})

describe("hotkeyAction", () => {
  test("space and k toggle play, arrows jump 5 seconds, f fullscreen, m mute", () => {
    expect(hotkeyAction(" ")).toEqual({ kind: "toggle" })
    expect(hotkeyAction("k")).toEqual({ kind: "toggle" })
    expect(hotkeyAction("ArrowRight")).toEqual({ kind: "seek", by: 5 })
    expect(hotkeyAction("ArrowLeft")).toEqual({ kind: "seek", by: -5 })
    expect(hotkeyAction("f")).toEqual({ kind: "fullscreen" })
    expect(hotkeyAction("m")).toEqual({ kind: "mute" })
    expect(hotkeyAction("x")).toBeNull()
  })
})

describe("seekTarget", () => {
  test("stays inside the video", () => {
    expect(seekTarget(10, 5, 30)).toBe(15)
    expect(seekTarget(2, -5, 30)).toBe(0)
    expect(seekTarget(28, 5, 30)).toBe(30)
    expect(seekTarget(28, 5, null)).toBe(33)
  })
})

describe("PLAYBACK_RATES", () => {
  test("half speed to double speed", () => {
    expect(PLAYBACK_RATES).toEqual([0.5, 1, 1.5, 2])
  })
})

describe("placeMarkers", () => {
  const marker = (id: string, atMs: number, label = "503") => ({ id, atMs, kind: "network" as const, label, detail: id })

  test("each marker sits at its share of the video", () => {
    expect(placeMarkers([marker("a", 10_000), marker("b", 30_000)], 40)).toEqual([
      { leftPercent: 25, markers: [marker("a", 10_000)] },
      { leftPercent: 75, markers: [marker("b", 30_000)] },
    ])
  })

  test("markers closer than the gap share one spot, in time order", () => {
    const groups = placeMarkers([marker("b", 10_200), marker("a", 10_000), marker("c", 30_000)], 40)
    expect(groups.map((group) => group.markers.map((item) => item.id))).toEqual([["a", "b"], ["c"]])
    expect(groups[0]?.leftPercent).toBe(25)
  })

  test("events before the start or after the end are pinned to the edges", () => {
    expect(placeMarkers([marker("early", -2000), marker("late", 99_000)], 40).map((group) => group.leftPercent)).toEqual([0, 100])
  })

  test("nothing is placed until the length is known", () => {
    expect(placeMarkers([marker("a", 1000)], null)).toEqual([])
  })
})

describe("formatClock", () => {
  test("m:ss, and h:mm:ss past an hour", () => {
    expect(formatClock(3.4)).toBe("0:03")
    expect(formatClock(65)).toBe("1:05")
    expect(formatClock(3725)).toBe("1:02:05")
  })
})
