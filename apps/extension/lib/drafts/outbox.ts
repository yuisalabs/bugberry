import { isTrimmed, trimPayload } from "../review/review-data"
import { sameRange } from "../review/review-draft"
import type { SendOptions } from "../review/upload"
import type { DraftOutbox, ReportDraft } from "../shared/types"

/** The background's alarm while drafts wait for a connection. */
export const OUTBOX_ALARM = "bugberry-outbox"

export interface OutboxAlarms {
  get(name: string): Promise<unknown>
  create(name: string, info: { periodInMinutes: number }): Promise<void>
  clear(name: string): Promise<boolean>
}

/** A minute's alarm while drafts wait, none otherwise. One already set stays: made again, its minute would start over. */
export async function keepOutboxAlarm(alarms: OutboxAlarms, waiting: number): Promise<void> {
  if (waiting === 0) {
    await alarms.clear(OUTBOX_ALARM)
    return
  }
  if (!(await alarms.get(OUTBOX_ALARM))) await alarms.create(OUTBOX_ALARM, { periodInMinutes: 1 })
}

export const OUTBOX_DELAYS_MIN = [1, 2, 4, 8, 15]

/** Tries a server that answers with errors gets, about two hours; a lost connection is tried for as long as it takes. */
export const OUTBOX_MAX_SERVER_TRIES = 12

/** When try number `tries + 1` may run; the last delay repeats. */
export function nextTryAt(tries: number, now: number): number {
  const minutes = OUTBOX_DELAYS_MIN[Math.min(tries, OUTBOX_DELAYS_MIN.length - 1)]!
  return now + minutes * 60_000
}

/** The outbox Send saves: a screenshot keeps its exported picture, a recording's media is already on the draft. */
export function newOutbox(draft: ReportDraft, media: Blob, thumbnail: Blob | null, serverUrl: string, now: number): DraftOutbox {
  return { screenshot: draft.captureType === "screenshot" ? media : null, thumbnail, serverUrl, tries: 0, nextTryAt: nextTryAt(0, now) }
}

/** Whether the background may send it: queued, or left uploading by a closed tab, with what it needs. */
export const waiting = (draft: ReportDraft) =>
  (draft.status === "queued" || draft.status === "uploading") && draft.outbox != null && draft.form != null

/** Drafts the background may send now: queued or uploading, with an outbox and a form, due, oldest first. */
export function dueDrafts(drafts: readonly ReportDraft[], now: number): ReportDraft[] {
  return drafts
    .filter((draft) => waiting(draft) && draft.outbox!.nextTryAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** How many drafts wait for the background, due or not. */
export function waitingCount(drafts: readonly ReportDraft[]): number {
  return drafts.filter(waiting).length
}

export interface OutboxSend {
  media: Blob
  thumbnail: Blob | null
  options: Pick<SendOptions, "payload" | "durationMs">
}

/** What a queued draft uploads; null when it can't be sent without the editor. */
export function outboxSend(draft: ReportDraft): OutboxSend | null {
  const { outbox } = draft
  if (!outbox || !draft.form) return null
  const thumbnail = outbox.thumbnail
  if (draft.captureType === "screenshot") return outbox.screenshot ? { media: outbox.screenshot, thumbnail, options: {} } : null
  if (draft.captureType === "replay") return { media: draft.replay, thumbnail, options: {} }
  if (!draft.video) return null
  const range = draft.trim
  if (!isTrimmed(range, draft.durationMs ?? 0)) return { media: draft.video, thumbnail, options: {} }
  // Encoding needs the editor's page; only a file already cut to this range can go.
  if (!draft.trimmed || !sameRange(draft.trimmed.range, range)) return null
  const startedAt = draft.recordingStartedAt ?? draft.debuggerPayload?.recordingStartedAt ?? 0
  return {
    media: draft.trimmed.video,
    thumbnail,
    options: {
      payload: draft.debuggerPayload && trimPayload(draft.debuggerPayload, startedAt, range),
      durationMs: range.endMs - range.startMs,
    },
  }
}
