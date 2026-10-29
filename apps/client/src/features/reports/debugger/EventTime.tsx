import type { MouseEvent } from "react"
import { Button as AriaButton } from "react-aria-components"
import { formatClock, formatOffset } from "../../../lib/format"

const timeClass = "w-16 shrink-0 font-mono text-xs"

/**
 * For an event's whole row in a video report: a click anywhere on it plays the video from that moment, as its time
 * does. Clicks on the row's own controls (the time itself, a Stack toggle) and the click that ends a text selection
 * are left alone, so logs can still be copied. Undefined when there is no video to move.
 */
export function seekOnRowClick(
  t: number,
  base: number | null,
  onSeek?: (offsetMs: number) => void,
): ((event: MouseEvent<HTMLElement>) => void) | undefined {
  if (!onSeek || base === null) return undefined
  return (event) => {
    if ((event.target as Element).closest("button, a, input")) return
    if (window.getSelection()?.toString()) return
    onSeek(t - base)
  }
}

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
