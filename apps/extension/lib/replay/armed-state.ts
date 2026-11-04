import type { ReplayWindowMs } from "@bugberry/shared"
import { isReplayWindow } from "../capture/capture-prefs"

/** A tab armed for replay. The buffer itself lives in the page; this is only what the background needs to know. */
export interface ArmedTab {
  windowMs: ReplayWindowMs
  /** When the page's recorder last started, in epoch ms. */
  since: number
  /** The page dropped a segment early to stay under its byte cap. */
  degraded: boolean
  /** Paused while a video recording runs; the recorder is stopped. */
  suspended: boolean
}

/** Kept in storage.session, so arming survives the service worker going to sleep. */
export interface ArmedStore {
  get(tabId: number): Promise<ArmedTab | null>
  set(tabId: number, tab: ArmedTab): Promise<void>
  remove(tabId: number): Promise<void>
  all(): Promise<Record<number, ArmedTab>>
}

const KEY = "replay"

export function armedTabFrom(value: unknown): ArmedTab | null {
  if (typeof value !== "object" || value === null) return null
  const tab = value as Record<string, unknown>
  if (!isReplayWindow(tab.windowMs) || typeof tab.since !== "number") return null
  return { windowMs: tab.windowMs, since: tab.since, degraded: tab.degraded === true, suspended: tab.suspended === true }
}

export function createArmedStore(session: {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}): ArmedStore {
  const all = async () => {
    const raw = (await session.get(KEY))[KEY]
    const tabs: Record<number, ArmedTab> = {}
    if (typeof raw !== "object" || raw === null) return tabs
    for (const [id, value] of Object.entries(raw)) {
      const tab = armedTabFrom(value)
      if (tab) tabs[Number(id)] = tab
    }
    return tabs
  }
  // The map is written whole, so writes go one at a time: two tabs loading at once would otherwise lose one.
  let queue: Promise<unknown> = Promise.resolve()
  const change = (edit: (tabs: Record<number, ArmedTab>) => void) => {
    const next = queue.then(async () => {
      const tabs = await all()
      edit(tabs)
      await session.set({ [KEY]: tabs })
    })
    queue = next.catch(() => {})
    return next
  }
  return {
    get: async (tabId) => (await all())[tabId] ?? null,
    set: (tabId, tab) =>
      change((tabs) => {
        tabs[tabId] = tab
      }),
    remove: (tabId) =>
      change((tabs) => {
        delete tabs[tabId]
      }),
    all,
  }
}
