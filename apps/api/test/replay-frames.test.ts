import { beforeEach, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { encodeReplayMedia, MAX_REPLAY_FRAMES, REPLAY_FRAME_INTERVAL_MS, REPLAY_WINDOWS_MS, type ReplayEvent } from "@bugberry/shared"
import { MAX_PARALLEL_UNPACKS, reportObjectKeys, unpackReplayFrames } from "../src/modules/reports/replay-frames"
import { LocalStorageDriver } from "../src/storage/local"

const MEDIA_KEY = "reports/r1/media.json.gz"
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])
const JPEG_BASE64 = Buffer.from(JPEG_BYTES).toString("base64")
const META = { type: 4, timestamp: 10_000, data: { href: "http://localhost:3000/", width: 800, height: 600 } }
const SNAP = { type: 2, timestamp: 10_000, data: {} }
const frame = (timestamp: number, jpeg = JPEG_BASE64) => ({ type: 5, timestamp, data: { tag: "bugberry:frame", payload: { jpeg } } })

let storage: LocalStorageDriver

beforeEach(() => {
  storage = new LocalStorageDriver({
    dir: mkdtempSync(join(tmpdir(), "bugberry-replay-")),
    publicBaseUrl: "http://localhost:3000",
    secret: "storage-secret",
    uploadTtlSeconds: 3600,
    readTtlSeconds: 3600,
  })
})

async function putMedia(events: ReplayEvent[]) {
  const media = await encodeReplayMedia({ version: 1, events })
  await storage.writeObject(MEDIA_KEY, new Uint8Array(await media.arrayBuffer()))
}

test("writes a frame object per embedded frame and returns their times", async () => {
  await putMedia([META, SNAP, frame(15_000), frame(20_000)])
  expect(await unpackReplayFrames(storage, "r1", MEDIA_KEY)).toEqual({ ok: true, frames: [5_000, 10_000] })
  expect(await storage.head("reports/r1/frames/000.jpg")).toEqual({ size: JPEG_BYTES.length })
  const second = await storage.read("reports/r1/frames/001.jpg")
  expect(new Uint8Array(await second!.arrayBuffer())).toEqual(JPEG_BYTES)
})

test("a replay with no frames is fine", async () => {
  await putMedia([META, SNAP])
  expect(await unpackReplayFrames(storage, "r1", MEDIA_KEY)).toEqual({ ok: true, frames: [] })
  expect(await storage.head("reports/r1/frames/000.jpg")).toBeNull()
})

test("media that is not gzip is not readable", async () => {
  await storage.writeObject(MEDIA_KEY, new Uint8Array([1, 2, 3, 4]))
  expect(await unpackReplayFrames(storage, "r1", MEDIA_KEY)).toEqual({ ok: false, reason: "Replay recording is not readable" })
})

test("a gzip of the wrong shape is not readable", async () => {
  await storage.writeObject(MEDIA_KEY, new Uint8Array(Bun.gzipSync(JSON.stringify({ hello: 1 }))))
  expect(await unpackReplayFrames(storage, "r1", MEDIA_KEY)).toEqual({ ok: false, reason: "Replay recording is not readable" })
})

test("missing media is not readable", async () => {
  expect(await unpackReplayFrames(storage, "r1", MEDIA_KEY)).toEqual({ ok: false, reason: "Replay recording is not readable" })
})

test("media over the decompressed cap is too large", async () => {
  await putMedia([META, SNAP, frame(15_000)])
  expect(await unpackReplayFrames(storage, "r1", MEDIA_KEY, 64)).toEqual({ ok: false, reason: "Replay recording is too large" })
  expect(await storage.head("reports/r1/frames/000.jpg")).toBeNull()
})

test("more frames than the cap is too large, and nothing is written", async () => {
  await putMedia([META, SNAP, frame(15_000), frame(20_000)])
  expect(await unpackReplayFrames(storage, "r1", MEDIA_KEY, undefined, 1)).toEqual({ ok: false, reason: "Replay recording is too large" })
  expect(await storage.head("reports/r1/frames/000.jpg")).toBeNull()
})

test("the frame cap fits the three-digit frame keys", () => {
  expect(MAX_REPLAY_FRAMES).toBeLessThanOrEqual(1000)
  // Two windows of the longest length, a frame every interval, plus the one at the start.
  expect(MAX_REPLAY_FRAMES).toBeGreaterThan((2 * Math.max(...REPLAY_WINDOWS_MS)) / REPLAY_FRAME_INTERVAL_MS + 1)
})

test(`at most ${MAX_PARALLEL_UNPACKS} replays are unpacked at once`, async () => {
  await putMedia([META, SNAP, frame(15_000)])
  const read = storage.read.bind(storage)
  let active = 0
  let most = 0
  const gates: Array<() => void> = []
  storage.read = async (key) => {
    active++
    most = Math.max(most, active)
    await new Promise<void>((resolve) => gates.push(resolve))
    active--
    return read(key)
  }
  let settled = 0
  const runs = Array.from({ length: MAX_PARALLEL_UNPACKS + 2 }, () =>
    unpackReplayFrames(storage, "r1", MEDIA_KEY).finally(() => settled++),
  )
  // Opens the gates one by one until every run has finished; a queued run reaches its read only after one ends.
  while (settled < runs.length) {
    await Bun.sleep(5)
    gates.shift()?.()
  }
  for (const result of await Promise.all(runs)) expect(result).toEqual({ ok: true, frames: [5_000] })
  expect(most).toBe(MAX_PARALLEL_UNPACKS)
})

test("a storage error part way removes the frames already written", async () => {
  await putMedia([META, SNAP, frame(15_000), frame(20_000)])
  const replace = storage.replace.bind(storage)
  storage.replace = async (key, body, contentType) => {
    if (key.endsWith("001.jpg")) throw new Error("S3 hiccup")
    return replace(key, body, contentType)
  }
  await expect(unpackReplayFrames(storage, "r1", MEDIA_KEY)).rejects.toThrow("S3 hiccup")
  expect(await storage.head("reports/r1/frames/000.jpg")).toBeNull()
})

test("reportObjectKeys lists frames and always the thumbnail", () => {
  expect(reportObjectKeys({ id: "r1", mediaKey: MEDIA_KEY, debuggerKey: null, replayFrames: [0, 5_000] })).toEqual([
    MEDIA_KEY,
    "reports/r1/thumbnail.jpg",
    "reports/r1/frames/000.jpg",
    "reports/r1/frames/001.jpg",
  ])
  expect(reportObjectKeys({ id: "r1", mediaKey: "reports/r1/media.png", debuggerKey: "reports/r1/debugger.json.gz", replayFrames: null })).toEqual([
    "reports/r1/media.png",
    "reports/r1/debugger.json.gz",
    "reports/r1/thumbnail.jpg",
  ])
})
