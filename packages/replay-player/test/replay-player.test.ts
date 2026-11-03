import { expect, test } from "bun:test"
import { activeFrame, frameSrc, playerSize, stripFrames } from "../src"

test("frameSrc is a jpeg data url", () => {
  expect(frameSrc({ atMs: 0, jpeg: "AAAA" })).toBe("data:image/jpeg;base64,AAAA")
})

test("stripFrames thins to the max and keeps the last", () => {
  const frames = Array.from({ length: 48 }, (_, i) => ({ atMs: i * 5_000, jpeg: String(i) }))
  const strip = stripFrames(frames, 24)
  expect(strip).toHaveLength(24)
  expect(strip[0]?.atMs).toBe(0)
  expect(strip.at(-1)?.atMs).toBe(47 * 5_000)
  expect(stripFrames(frames.slice(0, 10), 24)).toHaveLength(10)
  expect(stripFrames([], 24)).toEqual([])
})

test("playerSize fits the container", () => {
  expect(playerSize({ width: 960 })).toEqual({ width: 960, height: 540 })
  expect(playerSize({ width: 200 })).toEqual({ width: 320, height: 180 })
})

test("activeFrame is the frame at or before the time", () => {
  expect(
    activeFrame(
      [
        { atMs: 0, jpeg: "" },
        { atMs: 5_000, jpeg: "" },
      ],
      7_000,
    ),
  ).toBe(1)
  expect(activeFrame([], 7_000)).toBeNull()
})
