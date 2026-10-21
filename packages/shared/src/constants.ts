export const ROLES = ["admin", "member"] as const
export type Role = (typeof ROLES)[number]

export const WORKSPACE_ROLES = ["admin", "member"] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const REPORT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const PRIORITIES = ["none", "low", "medium", "high", "critical"] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_RANK: Record<Priority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

/** Who sees a report: its workspace's members, everyone at the reporter's email domain, or anyone. */
export const VISIBILITIES = ["workspace", "internal", "public"] as const
export type Visibility = (typeof VISIBILITIES)[number]

export const CAPTURE_TYPES = ["screenshot", "video"] as const
export type CaptureType = (typeof CAPTURE_TYPES)[number]

/** A report sent without a title is named after its kind and its reporter: "Bugshoot by Ana", "Bugcord by Ana". */
export function defaultReportTitle(captureType: CaptureType, reporterName: string): string {
  return `${captureType === "video" ? "Bugcord" : "Bugshoot"} by ${reporterName.trim() || "someone"}`.slice(0, 200)
}

export const MEDIA_TYPES = {
  screenshot: "image/png",
  video: "video/webm",
} as const satisfies Record<CaptureType, string>

export const DEBUGGER_CONTENT_TYPE = "application/gzip"

/** The small JPEG preview the extension uploads with each report; best effort, never required. */
export const THUMBNAIL_CONTENT_TYPE = "image/jpeg"
export const MAX_THUMBNAIL_BYTES = 1024 * 1024
/** Previews are at most this wide; the server makes the same ones for older reports. */
export const THUMBNAIL_MAX_WIDTH = 640
/** JPEG quality from 0 to 1. */
export const THUMBNAIL_QUALITY = 0.7

export const UPLOAD_STATUSES = ["uploading", "ready", "failed"] as const
export type UploadStatus = (typeof UPLOAD_STATUSES)[number]

export const SHARE_SLUG_LENGTH = 12
export const MAX_PER_PAGE = 50

/** Chrome extension IDs are 32 letters from a to p. */
export const EXTENSION_ID_PATTERN = "^[a-p]{32}$"

/**
 * window.postMessage types between a BugBerry dashboard and the extension's bridge content script.
 * The page sends HELLO or USE_SERVER; the bridge answers HELLO with STATUS `{ active }` only on BugBerry servers.
 */
export const BRIDGE_HELLO = "bugberry:hello"
export const BRIDGE_STATUS = "bugberry:status"
export const BRIDGE_USE_SERVER = "bugberry:use-server"
/** Dashboard → extension: open the toolbar popup ("New report"). Answered with BRIDGE_POPUP. */
export const BRIDGE_OPEN_POPUP = "bugberry:open-popup"
export const BRIDGE_POPUP = "bugberry:popup"

/** A workspace's short URL: 3–40 of a–z, 0–9 and "-", not starting or ending with "-". */
export const WORKSPACE_SLUG_PATTERN = "^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$"
/** Names of the app's own top-level paths; kept free so workspaces could get their own addresses later. */
export const RESERVED_WORKSPACE_SLUGS = [
  "app",
  "api",
  "s",
  "login",
  "invite",
  "share",
  "settings",
  "admin",
  "assets",
  "static",
  "docs",
  "help",
  "www",
] as const
