import { ApiError, type EdenResult, unwrapWith } from "@bugberry/shared"

export { ApiError } from "@bugberry/shared"

const NETWORK_MESSAGE = "BugBerry can't be reached. Check your connection and try again."
const TEXT = { network: NETWORK_MESSAGE, fallback: "The request failed. Try again." }

/** Resolves an Eden call to its data, or throws an ApiError carrying the server's `{ code, message }`. */
export function unwrap<T>(request: Promise<EdenResult<T>>): Promise<NonNullable<T>> {
  return unwrapWith(TEXT, request)
}

const MESSAGES: Record<string, string> = {
  network: NETWORK_MESSAGE,
  unauthorized: "Sign in first",
  forbidden: "You don't have access to this",
  validation: "Some fields are invalid",
  rate_limited: "Too many requests. Try again in a moment.",
  internal: "Something went wrong on the server",
  maintenance: "BugBerry is down for maintenance. Try again later.",
  slug_taken: "Another project already uses this slug",
  project_has_reports: "This project still has reports. Delete them first.",
  project_not_found: "Project not found",
  report_not_found: "Report not found",
  comment_not_found: "Comment not found",
  invalid_emoji: "Pick an emoji to react with",
  empty_comment: "A comment can't be empty",
  integration_not_found: "Integration not found",
  invalid_config: "The integration settings are invalid",
  invalid_base_url: "The ActiveCollab address must start with https://",
  send_in_progress: "This report is being sent. Wait a moment, then reload.",
  assignee_not_found: "That member doesn't exist",
  last_admin: "A workspace needs at least one admin",
  extension_mismatch: "This extension isn't the one registered on the server (EXTENSION_ID)",
  workspace_not_found: "Workspace not found",
  member_not_found: "Member not found",
  no_workspace: "Join or create a workspace first",
  internal_unavailable: "Internal sharing needs a company email address",
  email_unavailable: "Email is not set up on this server, so invitations cannot be sent",
  invite_email_mismatch: "This invitation is for a different email address",
  invite_unavailable: "This invite has expired or was withdrawn. Ask for a new one.",
  invitation_not_found: "Invitation not found",
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message
  if (error instanceof Error) return error.message
  return String(error)
}
