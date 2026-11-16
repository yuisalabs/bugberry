import { defaultReportTitle } from "@bugberry/shared"
import type { BugberryApi } from "../server/api"
import type { Settings } from "../server/settings"
import { LOCKED, submitDraft, type UploadDeps } from "../review/upload"
import type { ReportDraft } from "../shared/types"
import type { DraftStore } from "./draft-store"
import { createDraftWriter } from "./draft-writer"
import { dueDrafts, nextTryAt, outboxSend, waitingCount } from "./outbox"
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

  const sendOne = async (draft: ReportDraft, settings: Settings): Promise<boolean> => {
    const outbox = draft.outbox!
    const form = draft.form!
    if (outbox.serverUrl !== settings.serverUrl) {
      await fail(draft.id, OTHER_SERVER_ERROR)
      return false
    }
    const send = outboxSend(draft)
    if (!send) {
      await fail(draft.id, NEEDS_EDITOR_ERROR)
      return false
    }
    const upload = deps.uploadDeps(settings)
    let locked = false
    const lock: NonNullable<UploadDeps["lock"]> = async (name, work) => {
      const result = upload.lock ? await upload.lock(name, work) : await work()
      if (result === LOCKED) locked = true
      return result
    }
    try {
      const sent = await submitDraft(draft.id, form, send.media, { ...upload, lock }, send.thumbnail, send.options)
      if (form.workspaceId) await deps.setLastWorkspace(form.workspaceId).catch(() => undefined)
      // The report exists by now: a refused assignment leaves it unassigned rather than unsent.
      if (form.assigneeId) await deps.apiFor(settings).updateReport(sent.id, { assigneeId: form.assigneeId }).catch(() => undefined)
      await deps.sentAway.add({
        draftId: draft.id,
        title: form.title.trim() || defaultReportTitle(draft.captureType, "you"),
        reportUrl: sent.reportUrl,
        sentAt: deps.now(),
      })
      return true
    } catch {
      // Another page is sending it: that page owns the draft until it lets go.
      if (locked) return false
      await write(draft.id, (current) =>
        current.status === "queued" && current.outbox
          ? { ...current, outbox: { ...current.outbox, tries: current.outbox.tries + 1, nextTryAt: nextTryAt(current.outbox.tries + 1, deps.now()) } }
          : null,
      )
      return false
    }
  }

  const flush = async () => {
    const settings = await deps.settings()
    const drafts = await deps.store.list()
    if (!settings || !deps.online()) return { sent: 0, waiting: waitingCount(drafts) }
    let sent = 0
    for (const draft of dueDrafts(drafts, deps.now())) {
      if (await sendOne(draft, settings)) sent += 1
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
