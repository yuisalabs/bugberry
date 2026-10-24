import { describe, expect, test } from "bun:test"
import { draftKept, draftWithNotes, draftWithTrim, sameRange, trimLocked } from "../lib/review-draft"
import type { ReportDraft } from "../lib/types"

const form = { workspaceId: "w1", projectId: "", title: "Pay fails", description: "", priority: "none" as const, visibility: "workspace" as const }
const session = { reportId: "r1" } as unknown as NonNullable<ReportDraft["session"]>
const note = { n: 1, atMs: 31_000, text: "Spins forever", author: "Dana" }

const draft = {
  id: "d1",
  captureType: "video",
  form,
  session,
  debuggerGzip: new Blob(["gz"]),
  debuggerPayload: { version: 1, capturedAt: 1, recordingStartedAt: 1, incomplete: [], events: [], notes: [note] },
} as unknown as ReportDraft

describe("draftWithNotes", () => {
  test("unchanged notes keep the encoded payload and the upload session", () => {
    expect(draftWithNotes(draft, [note])).toBe(draft)
  })

  test("edited notes go into the payload, and the payload is encoded again for a new upload", () => {
    const edited = draftWithNotes(draft, [{ ...note, text: "Spins after Pay" }])
    expect(edited.debuggerPayload?.notes).toEqual([{ ...note, text: "Spins after Pay" }])
    expect(edited.debuggerGzip).toBeNull()
    expect(edited.session).toBeNull()
  })
})

describe("draftKept", () => {
  test("the same form keeps the upload session", () => {
    expect(draftKept(draft, form, [note]).session).toBe(session)
  })

  test("a changed form is kept, and an upload made for the old one is not reused", () => {
    const kept = draftKept(draft, { ...form, title: "Checkout hangs" }, [note])
    expect(kept.form?.title).toBe("Checkout hangs")
    expect(kept.session).toBeNull()
  })
})

describe("draftWithTrim", () => {
  const range = { startMs: 6_000, endMs: 35_000 }
  const trimmedDraft = { ...draft, trim: range, trimmed: { range, video: new Blob(["cut"]) } } as unknown as ReportDraft

  test("a new range is kept, and the video, payload and upload made for the old one are dropped", () => {
    const next = draftWithTrim(trimmedDraft, { startMs: 1_000, endMs: 35_000 }) as Extract<ReportDraft, { captureType: "video" }>
    expect(next.trim).toEqual({ startMs: 1_000, endMs: 35_000 })
    expect(next.trimmed).toBeNull()
    expect(next.debuggerGzip).toBeNull()
    expect(next.session).toBeNull()
  })

  test("the same range changes nothing", () => {
    expect(draftWithTrim(trimmedDraft, { ...range })).toBe(trimmedDraft)
  })

  test("no range clears the trim", () => {
    const next = draftWithTrim(trimmedDraft, null) as Extract<ReportDraft, { captureType: "video" }>
    expect(next.trim).toBeNull()
    expect(next.trimmed).toBeNull()
  })

  test("a screenshot has nothing to trim", () => {
    const screenshot = { ...draft, captureType: "screenshot" } as unknown as ReportDraft
    expect(draftWithTrim(screenshot, range)).toBe(screenshot)
  })

  test("sameRange compares the two ends, and no range only matches no range", () => {
    expect(sameRange(range, { ...range })).toBe(true)
    expect(sameRange(range, { ...range, endMs: 1 })).toBe(false)
    expect(sameRange(null, undefined)).toBe(true)
    expect(sameRange(range, null)).toBe(false)
  })
})

describe("trimLocked", () => {
  test("only a video whose send has started is locked", () => {
    expect(trimLocked(draft)).toBe(false)
    expect(trimLocked({ ...draft, sendStarted: true } as unknown as ReportDraft)).toBe(true)
    expect(trimLocked({ ...draft, captureType: "screenshot", sendStarted: true } as unknown as ReportDraft)).toBe(false)
  })
})
