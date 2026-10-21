import { ApiError } from "./api"
import { type CaptureResult, capturable, UNCAPTURABLE } from "./capture-flow"
import { type CapturePrefs, effectiveSource, type RecordSource, type ScreenshotMode } from "./capture-prefs"
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

/** The tile chosen in the popup: its dial takes this screenshot or starts this recording. */
export type CaptureChoice = { kind: "screenshot"; mode: ScreenshotMode } | { kind: "record"; source: RecordSource }

export function choiceOf(prefs: CapturePrefs, tabRecorder: boolean): CaptureChoice {
  return prefs.captureKind === "record"
    ? { kind: "record", source: effectiveSource(prefs.recordSource, tabRecorder) }
    : { kind: "screenshot", mode: prefs.screenshotMode }
}

/** The dial's caption, the note under the chips and the footer's left side. */
export interface CaptureCopy {
  caption: string
  info: string | null
  footer: string
}

const CAPTIONS: Record<ScreenshotMode | RecordSource, string> = {
  visible: "Capture visible area",
  area: "Select an area",
  tab: "Record this tab",
  screen: "Record your screen",
  window: "Record a window",
}

/** `micShort` names the chosen microphone ("Realtek Audio"); null when the microphone is off. */
export function captureCopy(choice: CaptureChoice, micShort: string | null, logsOn: boolean): CaptureCopy {
  const fromThisTab = choice.kind === "record" && choice.source !== "tab"
  const footer = !logsOn ? "Logs aren't available on this page" : fromThisTab ? "Logs from this tab only" : "Console and network attached"
  if (choice.kind === "screenshot") return { caption: CAPTIONS[choice.mode], info: null, footer }
  const info =
    choice.source === "tab"
      ? micShort
        ? `Only this tab is recorded, with your voice from ${micShort}. Other tabs and apps stay private.`
        : "Only this tab is recorded. Other tabs and apps stay private."
      : `Your browser asks which ${choice.source} to share. Logs come from this tab only.`
  return { caption: CAPTIONS[choice.source], info, footer }
}

/** The popup's line next to REC. */
export function recordingLabel(source: RecordSource, sameTab: boolean): string {
  if (source === "screen") return "Recording your screen"
  if (source === "window") return "Recording a window"
  return sameTab ? "Recording this tab" : "Recording another tab"
}

/** "1 error", "9 actions". */
export function countText(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
