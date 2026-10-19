import { Button as AriaButton } from "react-aria-components"
import { formatClock, formatOffset } from "../../lib/format"

const timeClass = "w-16 shrink-0 font-mono text-xs"

/** Offset from the capture moment when known, else the clock time; a seek button for videos. */
export function EventTime({ t, base, onSeek }: { t: number; base: number | null; onSeek?: (offsetMs: number) => void }) {
  const label = base === null ? formatClock(t) : formatOffset(t - base)
  if (onSeek && base !== null) {
    return (
      <AriaButton
        onPress={() => onSeek(t - base)}
        aria-label={`Play video from ${label}`}
        className={`${timeClass} text-left text-primary hover:underline`}
      >
        <span title={formatClock(t)}>{label}</span>
      </AriaButton>
    )
  }
  return (
    <time className={`${timeClass} text-muted-foreground`} title={formatClock(t)}>
      {label}
    </time>
  )
}
