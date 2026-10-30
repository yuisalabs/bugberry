import { beforeEach, describe, expect, test } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import { createIndexedDbDraftStore, type DraftStore, LEGACY_DRAFT_DATABASE } from "../../lib/drafts/draft-store"
import type { ReportDraft, ScreenshotDraft } from "../../lib/shared/types"

let factory: IDBFactory
let store: DraftStore

const draft = (id: string, createdAt: number): ReportDraft => ({
  id,
  createdAt,
  captureType: "screenshot",
  page: { url: "https://app.test/", title: "App" },
  device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
  screenshot: new Blob(["png-bytes"], { type: "image/png" }),
  debuggerPayload: null,
  debuggerGzip: null,
  status: "editing",
  error: null,
  session: null,
  form: null,
  annotations: [],
})

beforeEach(() => {
  factory = new IDBFactory()
  store = createIndexedDbDraftStore(factory)
})

/** Writes drafts straight into a database, the way an older version of the extension left them, then closes it. */
function seed(name: string, drafts: ReportDraft[]) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "id" })
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction("drafts", "readwrite")
      for (const item of drafts) transaction.objectStore("drafts").put(item)
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    }
  })
}

const names = async () => (await factory.databases()).map((info) => info.name)

describe("drafts from before the rename", () => {
  test("move from the old database into the new one, which is then the only one", async () => {
    await seed(LEGACY_DRAFT_DATABASE, [draft("before", 1), draft("both", 2)])
    // A copy already in the new database wins over the old one.
    await seed("bugberry", [{ ...draft("both", 2), status: "failed", error: "kept" }])
    const moved = createIndexedDbDraftStore(factory)
    expect((await moved.list()).map((item) => item.id).sort()).toEqual(["before", "both"])
    expect((await moved.get("both"))?.error).toBe("kept")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await names()).toEqual(["bugberry"])
  })

  test("without an old database, none is made", async () => {
    await store.put(draft("a", 1))
    expect(await names()).toEqual(["bugberry"])
  })
})

describe("IndexedDB draft store", () => {
  test("round-trips a draft including its screenshot blob", async () => {
    await store.put(draft("a", 1))
    const loaded = (await store.get("a")) as ScreenshotDraft | null
    expect(loaded?.page.title).toBe("App")
    expect(loaded?.screenshot.type).toBe("image/png")
    expect(await loaded?.screenshot.text()).toBe("png-bytes")
  })

  test("lists newest first and survives reopening", async () => {
    await store.put(draft("old", 1))
    await store.put(draft("new", 2))
    const reopened = createIndexedDbDraftStore(factory)
    expect((await reopened.list()).map((item) => item.id)).toEqual(["new", "old"])
  })

  test("put replaces, delete removes, missing ids return null", async () => {
    await store.put(draft("a", 1))
    await store.put({ ...draft("a", 1), status: "failed", error: "offline" })
    expect((await store.get("a"))?.status).toBe("failed")
    await store.delete("a")
    expect(await store.get("a")).toBeNull()
    expect(await store.get("missing")).toBeNull()
  })
})

describe("saveAnnotations", () => {
  test("stores the shapes on the draft so a reopened draft keeps its blur", async () => {
    const { saveAnnotations } = await import("../../lib/drafts/draft-store")
    await store.put(draft("a", 1))
    const blur = { kind: "blur" as const, from: { x: 1, y: 1 }, to: { x: 40, y: 20 } }
    await saveAnnotations(store, "a", [blur])
    expect(((await store.get("a")) as ScreenshotDraft | null)?.annotations).toEqual([blur])
    await saveAnnotations(store, "missing", [blur])
    expect(await store.get("missing")).toBeNull()
  })
})
