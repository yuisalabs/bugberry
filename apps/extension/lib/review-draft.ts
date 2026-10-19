import type { RecordingNote } from "@bugberry/capture"
import type { ReportDraft } from "./types"
import { type ReportForm, sameForm } from "./upload"

const sameNotes = (a: readonly RecordingNote[], b: readonly RecordingNote[]) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The draft with the reporter's edited notes. The payload is encoded once per upload session, so changed
 * notes drop the encoded copy and the session: the next send uploads the new notes.
 */
export function draftWithNotes(draft: ReportDraft, notes: RecordingNote[]): ReportDraft {
  if (!draft.debuggerPayload || sameNotes(draft.debuggerPayload.notes ?? [], notes)) return draft
  return { ...draft, debuggerPayload: { ...draft.debuggerPayload, notes }, debuggerGzip: null, session: null }
}

/** What "Keep this as a draft" stores: the form and notes, without reusing an upload made for other values. */
export function draftKept(draft: ReportDraft, form: ReportForm, notes: RecordingNote[]): ReportDraft {
  const withNotes = draftWithNotes(draft, notes)
  return { ...withNotes, form, session: sameForm(draft.form, form) ? withNotes.session : null }
}
