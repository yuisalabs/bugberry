import { beforeEach, describe, expect, test } from "bun:test"
import type { CaptureEvent } from "@bugberry/capture"
import type { DraftStore } from "../lib/draft-store"
import type { TrimRange } from "../lib/review-data"
import { prepareVideo } from "../lib/trim-send"
import type { ReportDraft, VideoDraft } from "../lib/types"

const events: CaptureEvent[] = [
  { kind: "console", t: 1000 + 2_000, level: "error", args: ["cut"] },
  { kind: "console", t: 1000 + 10_000, level: "error", args: ["kept"] },
]
const range: TrimRange = { startMs: 6_000, endMs: 35_000 }
const original = new Blob(["whole"])

const draft: VideoDraft = {
  id: "v1",
  createdAt: 1,
  captureType: "video",
  page: { url: "https://app.test", title: "" },
  device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
  video: original,
  durationMs: 42_000,
  recordingStartedAt: 1000,
  debuggerPayload: { version: 1, capturedAt: 1, recordingStartedAt: 1000, incomplete: [], events },
  debuggerGzip: null,
  status: "editing",
  error: null,
  session: null,
  form: null,
}

let stored: Map<string, ReportDraft>
let encodes: TrimRange[]
const store: Pick<DraftStore, "get" | "put"> = {
  get: async (id) => stored.get(id) ?? null,
  put: async (next) => void stored.set(next.id, next),
}
const encoded = new Blob(["cut"])
const trimVideo = async (_video: Blob, cut: TrimRange) => {
  encodes.push(cut)
  return encoded
}

beforeEach(() => {
  stored = new Map()
  encodes = []
})

describe("prepareVideo", () => {
  test("untrimmed sends the original, encoding nothing", async () => {
    stored.set("v1", draft)
    const prepared = await prepareVideo(draft, { store, trimVideo })
    expect(prepared).toEqual({ media: original, payload: draft.debuggerPayload, durationMs: 42_000 })
    expect(encodes).toEqual([])
  })

  test("a trimmed draft is encoded once and the result is saved with its range", async () => {
    const trimmed = { ...draft, trim: range }
    stored.set("v1", trimmed)
    const prepared = await prepareVideo(trimmed, { store, trimVideo })
    expect(encodes).toEqual([range])
    expect(prepared.media).toBe(encoded)
    expect(prepared.durationMs).toBe(29_000)
    expect(prepared.payload?.events).toEqual([events[1] as CaptureEvent])
    expect((stored.get("v1") as VideoDraft).trimmed).toEqual({ range, video: encoded })
  })

  test("a retry reuses the trimmed video", async () => {
    const ready = { ...draft, trim: range, trimmed: { range: { ...range }, video: encoded } }
    stored.set("v1", ready)
    expect((await prepareVideo(ready, { store, trimVideo })).media).toBe(encoded)
    expect(encodes).toEqual([])
  })

  test("a video made for another range is encoded again", async () => {
    const stale = { ...draft, trim: range, trimmed: { range: { startMs: 0, endMs: 35_000 }, video: new Blob(["old"]) } }
    stored.set("v1", stale)
    await prepareVideo(stale, { store, trimVideo })
    expect(encodes).toEqual([range])
  })

  test("the save keeps what was stored meanwhile, such as edited notes", async () => {
    const trimmed = { ...draft, trim: range }
    const notes = [{ n: 1, atMs: 9_000, text: "edited", author: "D" }]
    stored.set("v1", { ...trimmed, debuggerPayload: { ...trimmed.debuggerPayload!, notes } })
    await prepareVideo(trimmed, { store, trimVideo })
    expect(stored.get("v1")?.debuggerPayload?.notes).toEqual(notes)
  })

  test("an encode error comes through and nothing is saved", async () => {
    const trimmed = { ...draft, trim: range }
    stored.set("v1", trimmed)
    const failing = async () => {
      throw new Error("codec")
    }
    await expect(prepareVideo(trimmed, { store, trimVideo: failing })).rejects.toThrow("codec")
    expect(stored.get("v1")).toBe(trimmed)
  })

  test("sending the full video drops the trim and what was made for it, so a retry sends the full video too", async () => {
    const trimmed = { ...draft, trim: range, trimmed: { range, video: encoded }, debuggerGzip: new Blob(["cut-gz"]) }
    stored.set("v1", trimmed)
    const prepared = await prepareVideo(trimmed, { store, trimVideo }, undefined, { fullVideo: true })
    expect(prepared).toEqual({ media: original, payload: draft.debuggerPayload, durationMs: 42_000 })
    const after = stored.get("v1") as VideoDraft
    expect(after.trim).toBeNull()
    expect(after.trimmed).toBeNull()
    expect(after.debuggerGzip).toBeNull()

    // "Try again" sends without the option: the stored draft is no longer trimmed.
    expect((await prepareVideo(after, { store, trimVideo })).media).toBe(original)
    expect(encodes).toEqual([])
  })
})
