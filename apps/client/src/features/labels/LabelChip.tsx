import type { LabelColor } from "@bugberry/shared"
import { labelColorClass } from "./label-colors"

/** One label, truncated to its chip; the full name is its title. */
export function LabelChip({ label, className = "" }: { label: { name: string; color: LabelColor }; className?: string }) {
  return (
    <span
      title={label.name}
      className={`inline-block max-w-32 truncate rounded-md px-1.5 py-0.5 text-xs/4 font-medium ${labelColorClass(label.color)} ${className}`}
    >
      {label.name}
    </span>
  )
}

/** Up to `max` chips on one line, then "+N" naming the rest in its title and to screen readers. Nothing when there are none. */
export function LabelChips({ labels, max = 3 }: { labels: ReadonlyArray<{ id: string; name: string; color: LabelColor }>; max?: number }) {
  if (labels.length === 0) return null
  const shown = labels.slice(0, max)
  const hidden = labels.slice(max)
  return (
    <span className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {shown.map((label) => (
        <LabelChip key={label.id} label={label} className="shrink" />
      ))}
      {hidden.length > 0 && (
        <span title={hidden.map((label) => label.name).join(", ")} className="shrink-0 text-xs/4 font-medium text-muted-foreground">
          <span aria-hidden>+{hidden.length}</span>
          <span className="sr-only">{`and ${hidden.length} more: ${hidden.map((label) => label.name).join(", ")}`}</span>
        </span>
      )}
    </span>
  )
}
