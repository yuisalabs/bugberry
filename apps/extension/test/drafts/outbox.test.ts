import { describe, expect, test } from "bun:test"
import { dueDrafts, newOutbox, nextTryAt, outboxSend, waitingCount } from "../../lib/drafts/outbox"
import type { DraftOutbox, ReportDraft, ReportForm } from "../../lib/shared/types"

const RAW = new Blob(["raw"])
const EXPORTED = new Blob(["exported"])
const WHOLE = new Blob(["whole"])
const CUT = new Blob(["cut"])
const REPLAY = new Blob(["replay"])

const FORM = { workspaceId: "w1", projectId: null, title: "Broken", description: "", priority: "medium", visibility: "workspace" } as unknown as ReportForm

const outbox = (overrides: Partial<DraftOutbox> = {}): DraftOutbox => ({
  screenshot: null,
  thumbnail: null,
  serverUrl: "https://bb.test",
  tries: 0,
  nextTryAt: 0,
  ...overrides,
})

const base = (overrides: Partial<ReportDraft>) =>
  ({
    id: "d1",
    createdAt: 1,
    page: { url: "https://app.test", title: "App" },
    device: {},
    debuggerPayload: null,
    debuggerGzip: null,
    status: "queued",
    error: null,
    session: null,
    form: FORM,
    ...overrides,
  }) as ReportDraft

const screenshotDraft = (overrides: Partial<ReportDraft> = {}) =>
  base({ captureType: "screenshot", screenshot: RAW, annotations: [], ...overrides } as Partial<ReportDraft>)
const videoDraft = (overrides: Partial<ReportDraft> = {}) =>
  base({ captureType: "video", video: WHOLE, durationMs: 9000, recordingStartedAt: 100, ...overrides } as Partial<ReportDraft>)
const replayDraft = (overrides: Partial<ReportDraft> = {}) =>
  base({ captureType: "replay", replay: REPLAY, durationMs: 5000, recordingStartedAt: 100, frames: [], ...overrides } as Partial<ReportDraft>)

describe("nextTryAt", () => {
  test("backs off 1, 2, 4, 8, then 15 minutes", () => {
    expect([0, 1, 2, 3, 4, 9].map((tries) => nextTryAt(tries, 0) / 60_000)).toEqual([1, 2, 4, 8, 15, 15])
  })
})

describe("newOutbox", () => {
  test("a screenshot keeps the exported picture; a recording keeps none", () => {
    expect(newOutbox(screenshotDraft(), EXPORTED, null, "https://bb.test", 0)).toEqual({
      screenshot: EXPORTED,
      thumbnail: null,
      serverUrl: "https://bb.test",
      tries: 0,
      nextTryAt: 60_000,
    })
    expect(newOutbox(videoDraft(), WHOLE, null, "https://bb.test", 0).screenshot).toBeNull()
  })
})

describe("outboxSend", () => {
  test("a queued screenshot sends the exported PNG, not the capture", () => {
    const send = outboxSend(screenshotDraft({ screenshot: RAW, outbox: outbox({ screenshot: EXPORTED }) } as Partial<ReportDraft>))
    expect(send?.media).toBe(EXPORTED)
  })

  test("a queued screenshot without an exported PNG can't be sent", () => {
    expect(outboxSend(screenshotDraft({ outbox: outbox({ screenshot: null }) }))).toBeNull()
  })

  test("a trimmed video sends the trimmed file, its payload and its length", () => {
    const range = { startMs: 1000, endMs: 4000 }
    const send = outboxSend(
      videoDraft({ video: WHOLE, trim: range, trimmed: { range, video: CUT }, durationMs: 9000, outbox: outbox() } as Partial<ReportDraft>),
    )
    expect(send?.media).toBe(CUT)
    expect(send?.options.durationMs).toBe(3000)
  })

  test("a video trimmed to a range it has no file for can't be sent", () => {
    const send = outboxSend(
      videoDraft({ trim: { startMs: 1000, endMs: 4000 }, trimmed: null, durationMs: 9000, outbox: outbox() } as Partial<ReportDraft>),
    )
    expect(send).toBeNull()
  })

  test("an untrimmed video and a replay send the draft's own media", () => {
    const thumbnail = new Blob(["thumb"])
    const video = outboxSend(videoDraft({ outbox: outbox({ thumbnail }) }))
    expect(video?.media).toBe(WHOLE)
    expect(video?.thumbnail).toBe(thumbnail)
    expect(video?.options).toEqual({})
    const replay = outboxSend(replayDraft({ outbox: outbox() }))
    expect(replay?.media).toBe(REPLAY)
    expect(replay?.options).toEqual({})
  })

  test("no outbox or no form: nothing to send", () => {
    expect(outboxSend(videoDraft({ outbox: null }))).toBeNull()
    expect(outboxSend(videoDraft({ outbox: outbox(), form: null }))).toBeNull()
  })
})

describe("dueDrafts and waitingCount", () => {
  test("due drafts: queued or uploading, with an outbox, past nextTryAt, oldest first", () => {
    const drafts = [
      videoDraft({ id: "late", createdAt: 3, outbox: outbox() }),
      videoDraft({ id: "uploading", createdAt: 2, status: "uploading", outbox: outbox() }),
      videoDraft({ id: "early", createdAt: 1, outbox: outbox() }),
      videoDraft({ id: "editing", status: "editing", outbox: outbox() }),
      videoDraft({ id: "failed", status: "failed", outbox: outbox() }),
      videoDraft({ id: "recording", status: "recording", outbox: outbox() }),
      videoDraft({ id: "not-due", outbox: outbox({ nextTryAt: 2000 }) }),
      videoDraft({ id: "no-outbox", outbox: null }),
      videoDraft({ id: "no-form", form: null, outbox: outbox() }),
    ]
    expect(dueDrafts(drafts, 1000).map((draft) => draft.id)).toEqual(["early", "uploading", "late"])
    expect(waitingCount(drafts)).toBe(4)
  })
})
