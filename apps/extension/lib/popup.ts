import { ApiError } from "./api"
import { type CaptureResult, capturable, UNCAPTURABLE } from "./capture-flow"
import type { RecordSource } from "./capture-prefs"
import type { RecordingStatus } from "./recording-flow"
import type { ReportDraft } from "./types"

/** `recording` is undefined until the background has answered the status request. */
export function draftNote(draft: ReportDraft, recording: RecordingStatus | undefined): string | null {
  if (draft.status === "failed") return "(failed)"
  if (draft.status === "uploading") return "(upload interrupted)"
  if (draft.status !== "recording") return null
  if (recording === undefined) return "(checking…)"
  return recording.recording && recording.draftId === draft.id ? "(recording)" : "(recording interrupted)"
}

/** A draft still being recorded, or one whose state is not known yet, is not offered for deletion. */
export function canDelete(draft: ReportDraft, recording: RecordingStatus | undefined): boolean {
  if (draft.status !== "recording") return true
  if (recording === undefined) return false
  return !(recording.recording && recording.draftId === draft.id)
}

/** The background's answer, or an error when it gave none (the service worker went away mid-call). */
export function replyResult(value: unknown): CaptureResult {
  const reply = value as Partial<{ ok: unknown; draftId: unknown; error: unknown }> | undefined
  if (reply?.ok === true && typeof reply.draftId === "string") return { ok: true, draftId: reply.draftId }
  if (reply?.ok === false && typeof reply.error === "string") return value as CaptureResult
  return { ok: false, error: "The extension didn't respond. Try again." }
}

/** The dashboard session ended (or never started): only a 401 from the server says so. */
export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

/** Select area closes the popup before the background answers, so a page that can't be captured is caught here. */
export function uncapturableNote(url: string | undefined): string | null {
  return capturable(url) ? null : UNCAPTURABLE
}

/** A start the background would refuse, said in the popup; anything else closes the popup at once. */
export function recordStartNote(source: RecordSource, url: string | undefined): string | null {
  return source === "tab" && !capturable(url) ? "This page can't be recorded. Open a regular web page (http/https)." : null
}
