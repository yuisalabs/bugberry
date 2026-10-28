import { describe, expect, test } from "bun:test"
import { type CaptureEvent, decodeDebuggerPayload, DEBUGGER_PAYLOAD_VERSION } from "@bugberry/capture"
import { base64Chunk, prepareAutomationDraft } from "../lib/automation-draft"
import type { DraftStore } from "../lib/draft-store"
import type { ReportDraft, VideoDraft } from "../lib/types"

function storeWith(...drafts: ReportDraft[]): DraftStore {
  const map = new Map(drafts.map((draft) => [draft.id, draft]))
  return {
    put: async (draft) => void map.set(draft.id, draft),
    get: async (id) => map.get(id) ?? null,
    list: async () => [...map.values()],
    delete: async (id) => void map.delete(id),
  }
}

const VIDEO_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 255, 7])
const CLICK: CaptureEvent = { kind: "action", t: 2500, type: "click", target: 'button "Pay now"' }
const RELOAD: CaptureEvent = { kind: "action", t: 2100, type: "navigate", url: "https://shop.test/checkout", via: "reload" }

function videoDraft(overrides: Partial<VideoDraft> = {}, events: CaptureEvent[] = [CLICK, { kind: "console", t: 2501, level: "error", args: ["Pay failed"] }]): VideoDraft {
  return {
    id: "video-1",
    createdAt: 1000,
    captureType: "video",
    page: { url: "https://shop.test/checkout", title: "Checkout" },
    device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
    debuggerPayload: { version: DEBUGGER_PAYLOAD_VERSION, capturedAt: 9000, recordingStartedAt: 2000, incomplete: [], events },
    debuggerGzip: null,
    status: "editing",
    error: null,
    session: null,
    form: null,
    video: new Blob([VIDEO_BYTES], { type: "video/webm" }),
    durationMs: 5000,
    recordingStartedAt: 2000,
    ...overrides,
  } as VideoDraft
}

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
const noThumbnail = { makeThumbnail: async () => null }

describe("prepareAutomationDraft", () => {
  test("names each file's size and keeps the encoded payload", async () => {
    const prepared = await prepareAutomationDraft(storeWith(videoDraft()), "video-1", noThumbnail)
    expect(prepared.meta.sizes).toEqual({ media: VIDEO_BYTES.length, debugger: prepared.files.debugger.size, thumbnail: null })
    const payload = await decodeDebuggerPayload(prepared.files.debugger)
    expect(payload.events).toHaveLength(2)
  })

  test("carries the page, device, duration and a summary of what was caught", async () => {
    const prepared = await prepareAutomationDraft(storeWith(videoDraft({ stoppedAtLimitMs: 120_000, endReason: "max-duration" })), "video-1", noThumbnail)
    expect(prepared.meta).toMatchObject({
      durationMs: 5000,
      pageUrl: "https://shop.test/checkout",
      pageTitle: "Checkout",
      device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
      debuggerSummary: { actions: 1, logs: 1, incomplete: [] },
      stoppedAtLimitMs: 120_000,
      endReason: "max-duration",
      agentActions: 1,
    })
  })

  test("the recorder's own reload at the start is not the agent's action", async () => {
    const prepared = await prepareAutomationDraft(storeWith(videoDraft({}, [RELOAD])), "video-1", noThumbnail)
    expect(prepared.meta.debuggerSummary.actions).toBe(1)
    expect(prepared.meta.agentActions).toBe(0)
    const withClick = await prepareAutomationDraft(storeWith(videoDraft({}, [RELOAD, CLICK])), "video-1", noThumbnail)
    expect(withClick.meta.agentActions).toBe(1)
  })

  test("the thumbnail is made from the video", async () => {
    const seen: number[] = []
    const prepared = await prepareAutomationDraft(storeWith(videoDraft()), "video-1", {
      makeThumbnail: async (video, durationMs) => {
        seen.push(video.size, durationMs ?? -1)
        return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" })
      },
    })
    expect(seen).toEqual([VIDEO_BYTES.length, 5000])
    expect(prepared.meta.sizes.thumbnail).toBe(3)
  })

  test("a missing or unfinished recording is an error", async () => {
    await expect(prepareAutomationDraft(storeWith(), "video-1", noThumbnail)).rejects.toThrow("Recording not found")
    await expect(prepareAutomationDraft(storeWith(videoDraft({ video: null })), "video-1", noThumbnail)).rejects.toThrow("Recording not found")
  })
})

describe("base64Chunk", () => {
  test("reads a file a slice at a time, so a long video never crosses as one string", async () => {
    const blob = new Blob([VIDEO_BYTES])
    const parts = [await base64Chunk(blob, 0, 3), await base64Chunk(blob, 3, 3), await base64Chunk(blob, 6, 3)]
    expect(parts.map(bytesOf).flatMap((part) => [...part])).toEqual([...VIDEO_BYTES])
  })
})
