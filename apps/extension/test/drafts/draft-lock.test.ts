import { beforeEach, expect, test } from "bun:test"
import { deleteUnlessSending, takeOutOfQueue } from "../../lib/drafts/draft-lock"
import type { DraftStore } from "../../lib/drafts/draft-store"
import { LOCKED, type UploadDeps } from "../../lib/review/upload"
import type { ReportDraft } from "../../lib/shared/types"

let drafts: Map<string, ReportDraft>
let store: DraftStore
const free: NonNullable<UploadDeps["lock"]> = async (_name, work) => work()
const held: NonNullable<UploadDeps["lock"]> = async () => LOCKED

beforeEach(() => {
  drafts = new Map()
  store = {
    put: async (draft) => void drafts.set(draft.id, draft),
    get: async (id) => drafts.get(id) ?? null,
    list: async () => [...drafts.values()],
    delete: async (id) => void drafts.delete(id),
  }
  drafts.set("d1", { id: "d1", status: "queued", outbox: { tries: 2 } } as unknown as ReportDraft)
})

test("a draft nobody is sending is deleted", async () => {
  expect(await deleteUnlessSending(store, "d1", free)).toBe(true)
  expect(drafts.has("d1")).toBe(false)
})

test("a draft being sent is not deleted", async () => {
  expect(await deleteUnlessSending(store, "d1", held)).toBe(false)
  expect(drafts.has("d1")).toBe(true)
})

test("opening a queued draft takes it out of the queue, keeping its outbox", async () => {
  expect(await takeOutOfQueue(store, "d1", free)).toBe("taken")
  expect(drafts.get("d1")).toMatchObject({ status: "editing", outbox: { tries: 2 } })
})

test("a queued draft being sent stays queued", async () => {
  expect(await takeOutOfQueue(store, "d1", held)).toBe("sending")
  expect(drafts.get("d1")?.status).toBe("queued")
})

test("a draft that isn't queued is left alone", async () => {
  drafts.set("d1", { id: "d1", status: "failed" } as ReportDraft)
  expect(await takeOutOfQueue(store, "d1", free)).toBe("not-queued")
  expect(drafts.get("d1")?.status).toBe("failed")
})
