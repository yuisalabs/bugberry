import { useMemo } from "react"

/** The dashboard's video player, as the event tabs see it. */
export interface Playback {
  /** Player position in ms, or null before it has played. */
  currentMs: number | null
  /** Moves the player to an event offset (ms since recording start). */
  seek(offsetMs: number): void
}

/** Last index whose offset is at or before `currentMs`; -1 when none. Offsets are sorted ascending. */
export function activeIndex(offsets: readonly number[], currentMs: number | null): number {
  if (currentMs === null) return -1
  let low = 0
  let high = offsets.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if ((offsets[middle] ?? Number.POSITIVE_INFINITY) <= currentMs) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

/** Player position (seconds) for an event offset; events before the start or after the end are clamped. */
export function seekSeconds(offsetMs: number, durationMs: number | null): number {
  return Math.min(Math.max(offsetMs, 0), durationMs ?? Number.POSITIVE_INFINITY) / 1000
}

/**
 * activeRow for a list that re-renders as the video plays: the offsets are worked out once per list (pass a
 * memoized `times`), and each new position is a binary search.
 */
export function useActiveRow(times: readonly number[], base: number | null, playback: Playback | null): number {
  const offsets = useMemo(() => (base === null ? [] : times.map((t) => t - base)), [times, base])
  return !playback || base === null ? -1 : activeIndex(offsets, playback.currentMs)
}

/** Highlighted row of a list of event times, or -1 for screenshots and before playback. */
export function activeRow(times: readonly number[], base: number | null, playback: Playback | null): number {
  if (!playback || base === null) return -1
  return activeIndex(
    times.map((t) => t - base),
    playback.currentMs,
  )
}
