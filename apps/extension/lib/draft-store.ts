import type { Shape } from "./annotations"
import type { ReportDraft } from "./types"

export interface DraftStore {
  put(draft: ReportDraft): Promise<void>
  get(id: string): Promise<ReportDraft | null>
  list(): Promise<ReportDraft[]>
  delete(id: string): Promise<void>
}

const STORE = "drafts"

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run<T>(database: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE, mode)
    const request = action(transaction.objectStore(STORE))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export const DRAFT_DATABASE = "bugberry"
/** The database's name before the rename; its drafts move over the first time the store opens. */
export const LEGACY_DRAFT_DATABASE = "fdebag"

async function databaseExists(factory: IDBFactory, name: string): Promise<boolean> {
  // Opening a database that isn't there would create it, so ask for the list where the browser has one.
  if (typeof factory.databases !== "function") return true
  return (await factory.databases()).some((info) => info.name === name)
}

/**
 * Moves the drafts of the database's old name into `database`, then deletes the old one. A draft already in the
 * new database stays as it is, so running twice (two extension pages opening at once) changes nothing.
 */
async function moveLegacyDrafts(factory: IDBFactory, database: IDBDatabase): Promise<void> {
  if (!(await databaseExists(factory, LEGACY_DRAFT_DATABASE))) return
  const legacy = await openDatabase(factory, LEGACY_DRAFT_DATABASE)
  try {
    const drafts = (await run(legacy, "readonly", (store) => store.getAll())) as ReportDraft[]
    const kept = new Set((await run(database, "readonly", (store) => store.getAllKeys())) as IDBValidKey[])
    for (const draft of drafts) {
      if (!kept.has(draft.id)) await run(database, "readwrite", (store) => store.put(draft))
    }
  } finally {
    legacy.close()
  }
  // Only once every draft is safe in the new database.
  factory.deleteDatabase(LEGACY_DRAFT_DATABASE)
}

/** Drafts live in the extension's own IndexedDB, shared by the background worker and extension pages. */
export function createIndexedDbDraftStore(factory: IDBFactory = indexedDB, databaseName = DRAFT_DATABASE): DraftStore {
  let database: Promise<IDBDatabase> | null = null
  const db = () => {
    database ??= openDatabase(factory, databaseName).then(async (opened) => {
      if (databaseName === DRAFT_DATABASE) {
        // Losing an old draft is worse than keeping a copy, so a failed move only waits for the next open.
        await moveLegacyDrafts(factory, opened).catch(() => {})
      }
      return opened
    })
    return database
  }

  return {
    async put(draft) {
      await run(await db(), "readwrite", (store) => store.put(draft))
    },
    async get(id) {
      return ((await run(await db(), "readonly", (store) => store.get(id))) as ReportDraft | undefined) ?? null
    },
    async list() {
      const drafts = (await run(await db(), "readonly", (store) => store.getAll())) as ReportDraft[]
      return drafts.sort((a, b) => b.createdAt - a.createdAt)
    },
    async delete(id) {
      await run(await db(), "readwrite", (store) => store.delete(id))
    },
  }
}

export async function saveAnnotations(store: DraftStore, draftId: string, annotations: Shape[]): Promise<void> {
  const draft = await store.get(draftId)
  if (draft?.captureType === "screenshot") await store.put({ ...draft, annotations })
}
