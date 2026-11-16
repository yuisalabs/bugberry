import { LOCKED, type UploadDeps } from "../review/upload"
import type { DraftStore } from "./draft-store"

/** Web Locks are shared by every extension page and released when a page closes. */
export const draftLock: NonNullable<UploadDeps["lock"]> = <T>(name: string, work: () => Promise<T>) =>
  // request() resolves with the callback's settled value; the DOM types do not unwrap the promise.
  navigator.locks.request(name, { ifAvailable: true }, async (held) => (held ? await work() : LOCKED)) as unknown as Promise<
    T | typeof LOCKED
  >

const lockName = (id: string) => `bugberry-draft-${id}`

/** Deletes the draft unless a page or the background is sending it; a send that ended after a delete would write it back. */
export async function deleteUnlessSending(store: Pick<DraftStore, "delete">, id: string, lock = draftLock): Promise<boolean> {
  return (await lock(lockName(id), async () => (await store.delete(id), true))) === true
}

/**
 * An editor opening a queued draft takes it out of the queue, so the background never sends a picture or form
 * the person is still changing. Create report puts it back.
 */
export async function takeOutOfQueue(
  store: Pick<DraftStore, "get" | "put">,
  id: string,
  lock = draftLock,
): Promise<"taken" | "sending" | "not-queued"> {
  const result = await lock(lockName(id), async () => {
    const current = await store.get(id)
    if (current?.status !== "queued") return "not-queued" as const
    await store.put({ ...current, status: "editing" })
    return "taken" as const
  })
  return result === LOCKED ? "sending" : result
}
