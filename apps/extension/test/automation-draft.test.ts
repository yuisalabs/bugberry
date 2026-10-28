import { describe, expect, test } from "bun:test"
import { decodeDebuggerPayload, DEBUGGER_PAYLOAD_VERSION } from "@bugberry/capture"
import { readAutomationDraft } from "../lib/automation-draft"
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

function videoDraft(overrides: Partial<VideoDraft> = {}): VideoDraft {
  return {
    id: "video-1",
    createdAt: 1000,
    captureType: "video",
    page: { url: "https://shop.test/checkout", title: "Checkout" },
    device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
    debuggerPayload: {
      version: DEBUGGER_PAYLOAD_VERSION,
      capturedAt: 9000,
      recordingStartedAt: 2000,
      incomplete: [],
      events: [
        { kind: "action", t: 2500, type: "click", target: 'button "Pay now"' },
        { kind: "console", t: 2501, level: "error", args: ["Pay failed"] },
      ],
    },
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

describe("readAutomationDraft", () => {
  test("readAutomationDraft returns sizes that match the base64 payloads", async () => {
    const draft = await readAutomationDraft(storeWith(videoDraft()), "video-1", noThumbnail)
    expect(bytesOf(draft.videoBase64)).toEqual(VIDEO_BYTES)
    const payload = await decodeDebuggerPayload(new Blob([bytesOf(draft.debuggerBase64)]))
    expect(payload.events).toHaveLength(2)
    expect(draft.thumbnailBase64).toBeNull()
  })

  test("carries the page, device, duration and a summary of what was caught", async () => {
    const draft = await readAutomationDraft(storeWith(videoDraft({ stoppedAtLimitMs: 120_000 })), "video-1", noThumbnail)
    expect(draft).toMatchObject({
      durationMs: 5000,
      pageUrl: "https://shop.test/checkout",
      pageTitle: "Checkout",
      device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
      debuggerSummary: { actions: 1, logs: 1, incomplete: [] },
      stoppedAtLimitMs: 120_000,
    })
  })

  test("the thumbnail is made from the video", async () => {
    const seen: number[] = []
    const draft = await readAutomationDraft(storeWith(videoDraft()), "video-1", {
      makeThumbnail: async (video, durationMs) => {
        seen.push(video.size, durationMs ?? -1)
        return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" })
      },
    })
    expect(seen).toEqual([VIDEO_BYTES.length, 5000])
    expect(bytesOf(draft.thumbnailBase64 ?? "")).toEqual(new Uint8Array([1, 2, 3]))
  })

  test("a missing or unfinished recording is an error", async () => {
    await expect(readAutomationDraft(storeWith(), "video-1", noThumbnail)).rejects.toThrow("Recording not found")
    await expect(readAutomationDraft(storeWith(videoDraft({ video: null })), "video-1", noThumbnail)).rejects.toThrow("Recording not found")
  })
})
