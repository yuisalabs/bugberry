import type { ReactNode, Ref } from "react"

/** What both the dashboard and the extension editor pass to the player. */
export interface VideoPlayerProps {
  src: string
  /** The recorded length, for files whose header carries no duration (MediaRecorder WebM). */
  durationMs?: number | null
  /** The underlying <video>, so other parts of the page can read or set its position. */
  videoRef?: Ref<HTMLVideoElement>
  /** Player position in ms, on every time update and seek. */
  onTime?: (ms: number) => void
  onError?: () => void
  onLoadedMetadata?: () => void
  className?: string
  /** Failed requests and errors to mark above the timeline. */
  markers?: TimelineMarker[]
  /** After the player jumped to a marker. */
  onMarkerClick?: (marker: TimelineMarker) => void
  /** Shown over the top-left of the video, with the controls. */
  topLeft?: ReactNode
  /** Shown over the top-right of the video; gets the current position in seconds. */
  topRight?: (currentSeconds: number) => ReactNode
  /** Where playback starts once the video has loaded (a shared "at 0:03" link). */
  startAtSeconds?: number
  /** Only this part plays (ms into the video): seeking stays inside it and playback stops at its end. */
  range?: PlayRange | null
}

export interface PlayRange {
  startMs: number
  endMs: number
}

/** Where the player belongs for a position in seconds: inside the range, and whether that is its end. */
export function clampToRange(seconds: number, range: PlayRange | null | undefined): { seconds: number; atEnd: boolean } {
  if (!range) return { seconds, atEnd: false }
  const start = range.startMs / 1000
  const end = range.endMs / 1000
  if (seconds < start) return { seconds: start, atEnd: false }
  if (seconds >= end) return { seconds: end, atEnd: true }
  return { seconds, atEnd: false }
}

export const PLAYBACK_RATES = [0.5, 1, 1.5, 2]
export const SEEK_STEP_SECONDS = 5

/** Seconds to show as the length: the file's own when it has one, else the recorded length, else none. */
export function displayDuration(playerSeconds: number, durationMs: number | null | undefined): number | null {
  if (Number.isFinite(playerSeconds) && playerSeconds > 0) return playerSeconds
  return durationMs ? durationMs / 1000 : null
}

export type HotkeyAction = { kind: "toggle" } | { kind: "seek"; by: number } | { kind: "fullscreen" } | { kind: "mute" }

/** Keyboard shortcuts while the player has focus. */
export function hotkeyAction(key: string): HotkeyAction | null {
  switch (key) {
    case " ":
    case "k":
      return { kind: "toggle" }
    case "ArrowRight":
      return { kind: "seek", by: SEEK_STEP_SECONDS }
    case "ArrowLeft":
      return { kind: "seek", by: -SEEK_STEP_SECONDS }
    case "f":
      return { kind: "fullscreen" }
    case "m":
      return { kind: "mute" }
    default:
      return null
  }
}

/** Where a relative jump lands, kept inside the video when its length is known. */
export function seekTarget(current: number, by: number, durationSeconds: number | null): number {
  const target = Math.max(0, current + by)
  return durationSeconds === null ? target : Math.min(durationSeconds, target)
}

/** Something worth seeing on the timeline: a failed request, an error, a note or a pause, at its offset into the video. */
export interface TimelineMarker {
  id: string
  /** Milliseconds since the recording started. */
  atMs: number
  kind: "network" | "error" | "note" | "pause"
  /** The short text on the dot: a status code, "xhr", "err", a note's number or "⏸". */
  label: string
  /** The longer line shown on hover. */
  detail: string
}

export interface MarkerGroup {
  leftPercent: number
  markers: TimelineMarker[]
}

/** Markers closer than this (in % of the timeline) share one dot, so they stay readable. */
export const MARKER_GAP_PERCENT = 1.5

/** Where each marker goes on a timeline `durationSeconds` long; neighbours are grouped. */
export function placeMarkers(markers: readonly TimelineMarker[], durationSeconds: number | null): MarkerGroup[] {
  if (!durationSeconds || durationSeconds <= 0) return []
  const groups: MarkerGroup[] = []
  for (const marker of [...markers].sort((a, b) => a.atMs - b.atMs)) {
    const leftPercent = Math.min(100, Math.max(0, (marker.atMs / 1000 / durationSeconds) * 100))
    const last = groups.at(-1)
    if (last && leftPercent - last.leftPercent < MARKER_GAP_PERCENT) last.markers.push(marker)
    else groups.push({ leftPercent, markers: [marker] })
  }
  return groups
}

/** What a dot says: its marker's label, or "×3" for three events that share the spot. */
export function markerLabel(group: MarkerGroup): string {
  return group.markers.length > 1 ? `×${group.markers.length}` : (group.markers[0]?.label ?? "")
}

/** "0:03", "1:05", or "1:02:05" past an hour. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const s = String(total % 60).padStart(2, "0")
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}:${s}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${s}`
}
