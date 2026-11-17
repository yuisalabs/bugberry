/** A report the background sent from the queue while no editor was open. */
export interface SentAway {
  draftId: string
  title: string
  reportUrl: string
  sentAt: number
}

export const MAX_SENT_AWAY = 20

export interface SentAwayStorage {
  list(): Promise<SentAway[]>
  add(sent: SentAway): Promise<void>
  remove(draftId: string): Promise<void>
}

const isSentAway = (value: unknown): value is SentAway => {
  const row = value as Partial<SentAway> | null
  return (
    typeof row === "object" &&
    row !== null &&
    typeof row.draftId === "string" &&
    typeof row.title === "string" &&
    typeof row.reportUrl === "string" &&
    typeof row.sentAt === "number"
  )
}

/** Runs `work` while no other page or the background holds `name` (navigator.locks in the browser). */
export type SentAwayLock = (name: string, work: () => Promise<void>) => Promise<void>

const LOCK_NAME = "bugberry-sent-away"

/**
 * Newest first, at most MAX_SENT_AWAY; over `local:sentAway`. Each change reads and writes the whole list, so changes
 * wait for each other: in this page by a queue, across the popup and the background by `lock`.
 */
export function createSentAwayStorage(
  area: { get(): Promise<SentAway[] | null>; set(value: SentAway[]): Promise<void> },
  lock?: SentAwayLock,
): SentAwayStorage {
  const list = async () => {
    const stored: unknown = await area.get()
    return Array.isArray(stored) && stored.every(isSentAway) ? stored : []
  }
  let queue: Promise<void> = Promise.resolve()
  const change = (next: (rows: SentAway[]) => SentAway[]) => {
    const write = async () => area.set(next(await list()))
    const run = queue.then(() => (lock ? lock(LOCK_NAME, write) : write()))
    queue = run.catch(() => undefined)
    return run
  }
  return {
    list,
    add: (sent) => change((rows) => [sent, ...rows.filter((row) => row.draftId !== sent.draftId)].slice(0, MAX_SENT_AWAY)),
    remove: (draftId) => change((rows) => rows.filter((row) => row.draftId !== draftId)),
  }
}
