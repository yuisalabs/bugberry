import { LOCKED, type UploadDeps } from "../review/upload"

/** Web Locks are shared by every extension page and released when a page closes. */
export const draftLock: NonNullable<UploadDeps["lock"]> = <T>(name: string, work: () => Promise<T>) =>
  // request() resolves with the callback's settled value; the DOM types do not unwrap the promise.
  navigator.locks.request(name, { ifAvailable: true }, async (held) => (held ? await work() : LOCKED)) as unknown as Promise<
    T | typeof LOCKED
  >
