import { describe, expect, test } from "bun:test"
import { draftKept, draftWithNotes } from "../lib/review-draft"
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
