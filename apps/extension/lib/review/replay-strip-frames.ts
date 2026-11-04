import { frameSrc, stripFrames } from "@bugberry/replay-player"
import { frameIndexAt, type ReplayFrame } from "@bugberry/shared"

/**
 * `count` frames for the replay's strip, as data URLs: each slot shows the screenshot taken at or before its middle,
 * so the row is filled and lines up with the playhead the way videoFrames does for a video. None without screenshots.
 */
export function replayStripFrames(frames: ReplayFrame[], durationMs: number, count: number): string[] {
  const shown = stripFrames(frames)
  if (shown.length === 0) return []
  return Array.from({ length: count }, (_, index) => {
    const middle = ((index + 0.5) * durationMs) / count
    return frameSrc(shown[frameIndexAt(shown, middle) ?? 0]!)
  })
}
