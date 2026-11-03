import { expect, test } from "bun:test"
import {
  decodeReplayMedia,
  encodeReplayMedia,
  frameIndexAt,
  isReplayMedia,
  replayDurationMs,
  replayFrames,
  replayStartedAt,
} from "../src"

const META = { type: 4, timestamp: 10_000, data: { href: "http://localhost:3000/", width: 800, height: 600 } }
const SNAP = { type: 2, timestamp: 10_000, data: {} }
const frame = (timestamp: number, jpeg = "/9j/") => ({ type: 5, timestamp, data: { tag: "bugberry:frame", payload: { jpeg } } })
const other = (timestamp: number) => ({ type: 5, timestamp, data: { tag: "something-else", payload: {} } })

test("frames are the tagged custom events, timed from the first event", () => {
  expect(replayFrames([META, SNAP, frame(15_000), other(16_000), frame(20_000, "AAAA")])).toEqual([
    { atMs: 5_000, jpeg: "/9j/" },
    { atMs: 10_000, jpeg: "AAAA" },
  ])
})

test("a frame without a string jpeg is not a frame", () => {
  expect(replayFrames([META, { type: 5, timestamp: 11_000, data: { tag: "bugberry:frame", payload: { jpeg: 3 } } }])).toEqual([])
})

test("frameIndexAt picks the last frame at or before the time", () => {
  const frames = [
    { atMs: 0, jpeg: "a" },
    { atMs: 5_000, jpeg: "b" },
    { atMs: 10_000, jpeg: "c" },
  ]
  expect(frameIndexAt(frames, 7_400)).toBe(1)
  expect(frameIndexAt(frames, 10_000)).toBe(2)
  expect(frameIndexAt([{ atMs: 5_000, jpeg: "b" }], 1_000)).toBeNull()
})

test("duration and start", () => {
  expect(replayStartedAt([META, SNAP, frame(15_000)])).toBe(10_000)
  expect(replayDurationMs([META, SNAP, frame(15_000)])).toBe(5_000)
  expect(replayDurationMs([META])).toBe(0)
})

test("isReplayMedia rejects the wrong shape", () => {
  expect(isReplayMedia({ version: 1, events: [META] })).toBe(true)
  expect(isReplayMedia({ version: 2, events: [META] })).toBe(false)
  expect(isReplayMedia({ version: 1, events: [] })).toBe(false)
  expect(isReplayMedia({ version: 1, events: [{ type: "x", timestamp: 1 }] })).toBe(false)
  expect(isReplayMedia([META])).toBe(false)
})

test("encode then decode round-trips and the blob is gzip", async () => {
  const blob = await encodeReplayMedia({ version: 1, events: [META, SNAP] })
  expect(blob.type).toBe("application/gzip")
  expect(new Uint8Array(await blob.slice(0, 2).arrayBuffer())).toEqual(new Uint8Array([0x1f, 0x8b]))
  expect(await decodeReplayMedia(blob)).toEqual({ version: 1, events: [META, SNAP] })
})

test("decode refuses a gzip of the wrong shape", async () => {
  const blob = new Blob([Bun.gzipSync(JSON.stringify({ hello: 1 }))])
  await expect(decodeReplayMedia(blob)).rejects.toThrow("Unsupported replay media")
})
