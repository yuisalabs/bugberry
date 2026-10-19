import type { CaptureType, Priority, ReportStatus, Role, Visibility } from "@bugberry/shared"

export const STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
}

export const STATUS_STYLES: Record<ReportStatus, string> = {
  open: "bg-sky-100 text-sky-800",
  in_progress: "bg-amber-100 text-amber-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-700",
}

/** The dot beside the status on the report page. */
export const STATUS_DOT_STYLES: Record<ReportStatus, string> = {
  open: "bg-sky-500",
  in_progress: "bg-amber-500",
  resolved: "bg-emerald-500",
  closed: "bg-slate-400",
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
}

export const PRIORITY_STYLES: Record<Priority, string> = {
  none: "bg-slate-100 text-slate-500",
  low: "bg-slate-200 text-slate-700",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
}

/** The flag beside the priority on the report page. */
export const PRIORITY_ICON_STYLES: Record<Priority, string> = {
  none: "text-muted-foreground",
  low: "text-slate-500",
  medium: "text-yellow-600",
  high: "text-orange-600",
  critical: "text-red-600",
}

export const VISIBILITY_LABELS: Record<Visibility, string> = { workspace: "Workspace", internal: "Internal", public: "Public" }

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", member: "Member" }

export const CAPTURE_LABELS: Record<CaptureType, string> = { screenshot: "Screenshot", video: "Video" }
