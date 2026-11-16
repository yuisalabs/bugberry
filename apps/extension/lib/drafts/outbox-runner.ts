import { defaultReportTitle } from "@bugberry/shared"
import type { BugberryApi } from "../server/api"
import type { Settings } from "../server/settings"
import { submitDraft, type UploadDeps } from "../review/upload"
import type { DraftStore } from "./draft-store"
import { createDraftWriter } from "./draft-writer"
import { dueDrafts, nextTryAt, outboxSend, waiting, waitingCount } from "./outbox"
import type { SentAwayStorage } from "./sent-away"

export interface OutboxDeps {
  store: DraftStore
  settings(): Promise<Settings | null>
  apiFor(settings: Settings): BugberryApi
  uploadDeps(settings: Settings): UploadDeps
  online(): boolean
  now(): number
  sentAway: SentAwayStorage
  setLastWorkspace(id: string): Promise<void>
}

export const OTHER_SERVER_ERROR = "This draft was made for another server. Open it to send it again."
export const NEEDS_EDITOR_ERROR = "Open this draft to send it."

/** Sends every due draft, one after another. Calls made while one runs get the same promise. */
export function createOutboxRunner(deps: OutboxDeps): () => Promise<{ sent: number; waiting: number }> {
  const write = createDraftWriter(deps.store)
  const fail = (id: string, error: string) => write(id, (current) => ({ ...current, status: "failed", error }))
  let running: Promise<{ sent: number; waiting: number }> | null = null

  /** Under the draft's lock: the draft as stored now, checked again, its next try booked before any byte goes out. */
  const sendLocked = async (id: string, settings: Settings, upload: UploadDeps): Promise<boolean> => {
    const draft = await deps.store.get(id)
    // Taken out of the queue (opened in the editor, sent, deleted) since the list was read.
    if (!draft || !waiting(draft)) return false
    const outbox = draft.outbox!
    const form = draft.form!
    if (outbox.serverUrl !== settings.serverUrl) {
      await fail(id, OTHER_SERVER_ERROR)
      return false
    }
    const send = outboxSend(draft)
    if (!send) {
      await fail(id, NEEDS_EDITOR_ERROR)
      return false
    }
    // Booked first: a service worker stopped mid-upload never reaches a catch.
    const tries = outbox.tries + 1
    await deps.store.put({ ...draft, outbox: { ...outbox, tries, nextTryAt: nextTryAt(tries, deps.now()) } })
    try {
      const sent = await submitDraft(id, form, send.media, { ...upload, lock: undefined }, send.thumbnail, send.options)
      if (form.workspaceId) await deps.setLastWorkspace(form.workspaceId).catch(() => undefined)
      // The report exists by now: a refused assignment leaves it unassigned rather than unsent.
      if (form.assigneeId) await deps.apiFor(settings).updateReport(sent.id, { assigneeId: form.assigneeId }).catch(() => undefined)
      await deps.sentAway.add({
        draftId: id,
        title: form.title.trim() || defaultReportTitle(draft.captureType, "you"),
        reportUrl: sent.reportUrl,
        sentAt: deps.now(),
      })
      return true
    } catch {
      return false
    }
  }

  const sendOne = async (id: string, settings: Settings): Promise<boolean> => {
    const upload = deps.uploadDeps(settings)
    if (!upload.lock) return sendLocked(id, settings, upload)
    // Another page holding the lock owns the draft until it lets go.
    const result = await upload.lock(`bugberry-draft-${id}`, () => sendLocked(id, settings, upload))
    return result === true
  }

  const flush = async () => {
    const settings = await deps.settings()
    const drafts = await deps.store.list()
    if (!settings || !deps.online()) return { sent: 0, waiting: waitingCount(drafts) }
    let sent = 0
    for (const draft of dueDrafts(drafts, deps.now())) {
      if (await sendOne(draft.id, settings)) sent += 1
    }
    return { sent, waiting: waitingCount(await deps.store.list()) }
  }

  return () => {
    running ??= flush().finally(() => {
      running = null
    })
    return running
  }
}
