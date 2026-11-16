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

/** Newest first, at most MAX_SENT_AWAY; over `local:sentAway`. `area` is injected for tests. */
export function createSentAwayStorage(area: { get(): Promise<SentAway[] | null>; set(value: SentAway[]): Promise<void> }): SentAwayStorage {
  const list = async () => {
    const stored: unknown = await area.get()
    return Array.isArray(stored) && stored.every(isSentAway) ? stored : []
  }
  return {
    list,
    add: async (sent) => area.set([sent, ...(await list()).filter((row) => row.draftId !== sent.draftId)].slice(0, MAX_SENT_AWAY)),
    remove: async (draftId) => area.set((await list()).filter((row) => row.draftId !== draftId)),
  }
}
