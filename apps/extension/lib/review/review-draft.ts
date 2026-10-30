import type { RecordingNote } from "@bugberry/capture"
import type { TrimRange } from "./review-data"
import type { ReportDraft } from "../types"
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

export const sameRange = (a: TrimRange | null | undefined, b: TrimRange | null | undefined) =>
  a && b ? a.startMs === b.startMs && a.endMs === b.endMs : !a && !b

/** The draft with a new trim; the video, payload encoding and upload made for another range are dropped. */
export function draftWithTrim(draft: ReportDraft, range: TrimRange | null): ReportDraft {
  if (draft.captureType !== "video" || sameRange(draft.trim, range)) return draft
  return { ...draft, trim: range, trimmed: null, debuggerGzip: null, session: null }
}

/** Once a send has started, the trim stays as it was sent. */
export function trimLocked(draft: ReportDraft): boolean {
  return draft.captureType === "video" && draft.sendStarted === true
}

/** What "Keep this as a draft" stores: the form and notes, without reusing an upload made for other values. */
export function draftKept(draft: ReportDraft, form: ReportForm, notes: RecordingNote[]): ReportDraft {
  const withNotes = draftWithNotes(draft, notes)
  return { ...withNotes, form, session: sameForm(draft.form, form) ? withNotes.session : null }
}
