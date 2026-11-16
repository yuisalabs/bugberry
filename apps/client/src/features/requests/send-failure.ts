import { ApiError } from "@bugberry/shared"
import { RequestClosed } from "./request-upload"
import { CaptureDenied, EmptyRecording } from "./screen-capture"

/** The server's codes in words for someone who has never seen BugBerry; its own messages are written for agents. */
const SEND_ERRORS: Record<string, string> = {
  recording_too_long: "This recording is longer than the link takes. Record a shorter one.",
  file_too_large: "This recording is too big to send. Record a shorter one.",
  rate_limited: "Too many tries from your connection. Wait a few minutes, then press Send again.",
  sender_name_invalid: "Type your name on one line, up to 80 characters.",
  page_url_invalid: "The page address must start with http:// or https://.",
  validation: "Check the email address, or leave it empty.",
  sender_email_invalid: "Check the email address, or leave it empty.",
  network: "BugBerry can't be reached. Check your connection, then press Send again.",
}

/** A workspace that keeps no more recordings refuses every try, so the page stops asking to send again. */
const WORKSPACE_FULL = new Set(["report_limit_reached", "duration_limit_reached"])

export type SendFailure = { closed: "link" | "full" } | { message: string }

/** What the page does after a send failed: close with a way to save the recording, or ask to try again. */
export function sendFailure(error: unknown): SendFailure {
  if (error instanceof RequestClosed) return { closed: "link" }
  if (error instanceof ApiError && WORKSPACE_FULL.has(error.code)) return { closed: "full" }
  if (error instanceof ApiError && SEND_ERRORS[error.code]) return { message: SEND_ERRORS[error.code] as string }
  return { message: "Sending stopped. Press Send again." }
}

/** Only the server's 404 means the link is dead; no answer or a 429 can be tried again. */
export function lookupFailure(error: unknown): "unavailable" | "unreachable" {
  return error instanceof ApiError && error.status === 404 ? "unavailable" : "unreachable"
}

/** What the page says when a capture didn't work; nothing when the person cancelled the browser's picker. */
export function captureFailure(error: unknown, kind: "video" | "screenshot"): string | null {
  if (error instanceof CaptureDenied) return null
  if (error instanceof EmptyRecording) return "Nothing was recorded. Record again, and keep it going for a second or two."
  return kind === "video" ? "The recording couldn't start. Try again, or take a screenshot." : "The screenshot couldn't be taken. Try again."
}
