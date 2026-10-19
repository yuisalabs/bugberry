import type { ReportStatus } from "@bugberry/shared"
import { STATUS_LABELS, STATUS_STYLES } from "../lib/labels"

/** A report's status as a small coloured label: Open, In progress, Resolved or Closed. */
export function StatusBadge({ status, className = "" }: { status: ReportStatus; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[status]} ${className}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status]}
    </span>
  )
}
