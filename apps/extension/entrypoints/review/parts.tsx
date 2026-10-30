import { type Priority, sizeLabel } from "@bugberry/shared"
import type { RemixiconComponentType } from "@remixicon/react"
import { ProgressBar } from "react-aria-components"
import type { UploadProgress } from "../../lib/review/upload"

export const PRIORITY_LABELS: Record<Priority, string> = { none: "No priority", low: "Low", medium: "Medium", high: "High", critical: "Critical" }

export function Tile({ icon: Icon, tone, title, value }: { icon: RemixiconComponentType; tone: "danger" | "warning" | "muted"; title: string; value: string }) {
  const color = tone === "danger" ? "text-danger-subtle-foreground" : tone === "warning" ? "text-warning-subtle-foreground" : "text-foreground"
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-border">
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone === "danger" ? "bg-danger-subtle" : tone === "warning" ? "bg-warning-subtle" : "bg-muted"}`}>
        <Icon size={18} aria-hidden className={tone === "muted" ? "text-muted-foreground" : color} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-muted-foreground">{title}</span>
        <span className={`truncate text-sm font-semibold ${color}`}>{value}</span>
      </span>
    </div>
  )
}

export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** Above the footer while a trimmed video is encoded, before its upload starts. */
export function PreparingBar({ fraction }: { fraction: number }) {
  const percent = Math.min(100, Math.max(0, Math.floor(fraction * 100)))
  return (
    <ProgressBar value={percent} aria-label="Preparing video" className="mx-5 flex flex-col gap-1.5 pb-3 sm:mx-7">
      <span className="text-xs text-muted-foreground tabular-nums">Preparing video… {percent}%</span>
      <span className="h-1 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </span>
    </ProgressBar>
  )
}

/** Above the footer while sending: how far the upload is, then that the server is making the report. */
export function UploadBar({ progress, isVideo }: { progress: UploadProgress; isVideo: boolean }) {
  const done = progress.sent >= progress.total
  const percent = progress.total > 0 ? Math.min(100, Math.floor((progress.sent / progress.total) * 100)) : 100
  const label = done ? "Creating report…" : isVideo ? "Uploading video" : "Uploading screenshot"
  return (
    <ProgressBar
      value={percent}
      aria-label={label}
      valueLabel={`${sizeLabel(progress.sent)} of ${sizeLabel(progress.total)}, ${percent}%`}
      className="mx-5 flex flex-col gap-1.5 pb-3 sm:mx-7"
    >
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {sizeLabel(progress.sent)} of {sizeLabel(progress.total)} · {percent}%
        </span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </span>
    </ProgressBar>
  )
}
