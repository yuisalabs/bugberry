import { describe, expect, test } from "bun:test"
import { activeIndex, activeRow, seekSeconds } from "../src/features/reports/debugger/timeline"

describe("activeIndex", () => {
  const offsets = [-500, 2000, 4000]

  test("finds the last event at or before the playhead", () => {
    expect(activeIndex(offsets, null)).toBe(-1)
    expect(activeIndex(offsets, -1000)).toBe(-1)
    expect(activeIndex(offsets, 0)).toBe(0)
    expect(activeIndex(offsets, 2000)).toBe(1)
    expect(activeIndex(offsets, 3999)).toBe(1)
    expect(activeIndex(offsets, 60_000)).toBe(2)
    expect(activeIndex([], 1000)).toBe(-1)
  })
})

describe("seekSeconds", () => {
  test("keeps the target inside the recording", () => {
    expect(seekSeconds(2500, 8000)).toBe(2.5)
    expect(seekSeconds(-500, 8000)).toBe(0)
    expect(seekSeconds(20_000, 8000)).toBe(8)
    expect(seekSeconds(20_000, null)).toBe(20)
  })
})

describe("activeRow", () => {
  const playing = { currentMs: 2500, seek: () => {} }

  test("only for a video with a known start", () => {
    expect(activeRow([1500, 3000], 1000, playing)).toBe(1)
    expect(activeRow([1500, 3000], 1000, null)).toBe(-1)
    expect(activeRow([1500, 3000], null, playing)).toBe(-1)
  })
})
