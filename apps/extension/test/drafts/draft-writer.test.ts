import { describe, expect, test } from "bun:test"
import { createDraftWriter } from "../../lib/drafts/draft-writer"
import type { DraftStore } from "../../lib/drafts/draft-store"
import type { ReportDraft } from "../../lib/types"

/** A store whose reads and writes take a while, as IndexedDB's do with a video inside. */
function slowStore(first: ReportDraft) {
  let saved = first
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
  const store: Pick<DraftStore, "get" | "put"> = {
    get: async () => {
      await tick()
      return saved
    },
    put: async (draft) => {
      await tick()
      saved = draft
    },
  }
  return { store, saved: () => saved }
}

const draft = { id: "v1", captureType: "video", form: null } as unknown as ReportDraft

describe("createDraftWriter", () => {
  test("changes made at the same time both land: neither puts back what the other replaced", async () => {
    const { store, saved } = slowStore(draft)
    const write = createDraftWriter(store)
    await Promise.all([
      write("v1", (current) => ({ ...current, trim: { startMs: 1000, endMs: 2000 } }) as ReportDraft),
      write("v1", (current) => ({ ...current, form: { title: "Edited" } }) as unknown as ReportDraft),
    ])
    expect(saved()).toMatchObject({ trim: { startMs: 1000, endMs: 2000 }, form: { title: "Edited" } })
  })

  test("a change that returns null writes nothing, and a missing draft is left missing", async () => {
    const { store, saved } = slowStore(draft)
    const write = createDraftWriter(store)
    await write("v1", () => null)
    expect(saved()).toBe(draft)
  })

  test("a failed change doesn't stop the ones after it", async () => {
    const { store, saved } = slowStore(draft)
    const write = createDraftWriter(store)
    const failed = write("v1", () => {
      throw new Error("boom")
    })
    const next = write("v1", (current) => ({ ...current, form: { title: "After" } }) as unknown as ReportDraft)
    await expect(failed).rejects.toThrow("boom")
    await next
    expect(saved()).toMatchObject({ form: { title: "After" } })
  })
})
