import type { Ref } from "react"
import type { TimelineMarker } from "@bugberry/player"
import { frameIndexAt, type ReplayEvent, type ReplayFrame } from "@bugberry/shared"

/** What the page can do with the player from outside it: a "0:35" in a comment, a click on a console row. */
export interface ReplayPlayerHandle {
  seek(ms: number): void
  play(): void
  pause(): void
  currentMs(): number
}

/** What both the dashboard and the extension's review page pass to the player. */
export interface ReplayPlayerProps {
  events: ReplayEvent[]
  durationMs: number
  /** Frames out of the events, already extracted so the strip needs no second pass. */
  frames: ReplayFrame[]
  /** Failed requests and errors to mark above the strip. */
  markers?: TimelineMarker[]
  /** After the player jumped to a marker. */
  onMarkerClick?: (marker: TimelineMarker) => void
  /** Player position in ms, on every time update and seek. */
  onTime?: (ms: number) => void
  /** Where playback starts (a shared "at 0:03" link). */
  startAtSeconds?: number
  playerRef?: Ref<ReplayPlayerHandle>
  className?: string
  /** Builds the rrweb player; tests pass a fake, since happy-dom can't run a replay. */
  createPlayer?: (target: HTMLElement, props: RrwebPlayerProps) => RrwebPlayerLike
}

export interface RrwebPlayerProps {
  events: ReplayEvent[]
  width: number
  height: number
  autoPlay: boolean
  showController: boolean
  skipInactive: boolean
  tags: Record<string, string>
}

/** The part of rrweb-player's instance the component uses. */
export interface RrwebPlayerLike {
  goto(ms: number, play?: boolean): void
  play(): void
  pause(): void
  addEventListener(event: string, handler: (detail: { payload: number }) => unknown): void
  getReplayer(): { getCurrentTime(): number }
  $set?(props: Partial<Pick<RrwebPlayerProps, "width" | "height">>): void
  $destroy(): void
}

export function frameSrc(frame: ReplayFrame): string {
  return `data:image/jpeg;base64,${frame.jpeg}`
}

/** Evenly spaced frames, at most `max` of them, always the first and the last. */
export function stripFrames(frames: ReplayFrame[], max = 24): ReplayFrame[] {
  if (frames.length <= max) return frames
  const step = (frames.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, index) => frames[Math.round(index * step)]!)
}

const MIN_WIDTH = 320

/** The player's box: as wide as its container (never under 320 px), as tall as the aspect makes it. */
export function playerSize(container: { width: number }, aspect = 16 / 9): { width: number; height: number } {
  const width = Math.max(MIN_WIDTH, Math.floor(container.width))
  return { width, height: Math.round(width / aspect) }
}

/** The strip's highlighted frame; null with no frames. */
export function activeFrame(frames: ReplayFrame[], currentMs: number): number | null {
  return frames.length === 0 ? null : frameIndexAt(frames, currentMs)
}
