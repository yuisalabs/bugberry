import type { DraftStore } from "./draft-store"
import type { ReportDraft } from "./types"

/** Changes the stored draft: gets the current one and returns the next, or null to write nothing. */
export type DraftChange = (current: ReportDraft) => ReportDraft | null

/**
 * One page's writes to its draft, one after another. Each reads the draft as the last write left it, so two
 * changes made at once (a new trim and an autosaved form) both land instead of the later one putting back what
 * the earlier one replaced. A failed change rejects its own call only.
 */
export function createDraftWriter(store: Pick<DraftStore, "get" | "put">) {
  let queue: Promise<unknown> = Promise.resolve()
  return (id: string, change: DraftChange): Promise<void> => {
    const run = queue.then(async () => {
      const current = await store.get(id)
      const next = current && change(current)
      if (next) await store.put(next)
    })
    queue = run.catch(() => undefined)
    return run
  }
}
