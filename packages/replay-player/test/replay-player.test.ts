import { expect, test } from "bun:test"
import { activeFrame, frameSrc, playerSize, replayAspect, stripFrames } from "../src"

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

test("playerSize without a height follows the container's width", () => {
  expect(playerSize({ width: 960 })).toEqual({ width: 960, height: 540 })
  expect(playerSize({ width: 200 })).toEqual({ width: 320, height: 180 })
  expect(playerSize({ width: 960 }, 4 / 3)).toEqual({ width: 960, height: 720 })
})

test("playerSize with a height is the largest box of the aspect that fits, under a controller when there is one", () => {
  expect(playerSize({ width: 1180, height: 600 }, 1835 / 934)).toEqual({ width: 1178, height: 600 })
  expect(playerSize({ width: 1180, height: 600 }, 1835 / 934, 80)).toEqual({ width: 1021, height: 520 })
  expect(playerSize({ width: 600, height: 900 }, 16 / 9)).toEqual({ width: 600, height: 338 })
})

test("replayAspect is the recorded viewport's, or 16/9 without one", () => {
  const meta = (data: unknown) => [{ type: 4, timestamp: 0, data }, { type: 2, timestamp: 0, data: {} }]
  expect(replayAspect(meta({ href: "https://app.test/", width: 1835, height: 934 }))).toBe(1835 / 934)
  expect(replayAspect(meta({ href: "https://app.test/" }))).toBe(16 / 9)
  expect(replayAspect(meta({ width: 0, height: 0 }))).toBe(16 / 9)
  expect(replayAspect([])).toBe(16 / 9)
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
