import type { ReactNode, Ref } from "react"
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
  /** Failed requests and errors, as dots on the progress line (and on the row above the strip). */
  markers?: TimelineMarker[]
  /** After the player jumped to a marker. */
  onMarkerClick?: (marker: TimelineMarker) => void
  /** Player position in ms, on every time update and seek. */
  onTime?: (ms: number) => void
  /** Each time playback starts or stops, from the player's buttons, hotkeys or the end of the replay. */
  onPlayingChange?: (playing: boolean) => void
  /** Where playback starts (a shared "at 0:03" link). */
  startAtSeconds?: number
  playerRef?: Ref<ReplayPlayerHandle>
  /** The bar above the replay, as on the video: who reported it on the left, actions for the current second on the right. */
  topLeft?: ReactNode
  topRight?: (seconds: number) => ReactNode
  /**
   * The parent sets the height (the extension's review): the replay fits the room the bar, markers and strip leave.
   * Otherwise it is as tall as its width makes it, as in the dashboard.
   */
  bounded?: boolean
  /** The marker row and the screenshots under the player; false when the page draws its own filmstrip. */
  strip?: boolean
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
}

/** The part of rrweb-player's instance the component uses. */
export interface RrwebPlayerLike {
  goto(ms: number, play?: boolean): void
  play(): void
  pause(): void
  /** "ui-update-current-time" carries ms, "ui-update-player-state" carries "playing" or "paused". */
  addEventListener(event: string, handler: (detail: { payload: number | string }) => unknown): void
  getReplayer(): { getCurrentTime(): number; setConfig(config: { speed: number }): void }
  $set?(props: Partial<Pick<RrwebPlayerProps, "width" | "height">>): void
  /** Rescales the replayed page to the player's box; $set alone only resizes the box. */
  triggerResize?(): void
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
const DEFAULT_ASPECT = 16 / 9
const RRWEB_META = 4

/** The recorded page's viewport, from rrweb's Meta event; 16/9 when there is none. */
export function replayAspect(events: ReplayEvent[]): number {
  const meta = events.find((event) => event.type === RRWEB_META)
  const data = (meta?.data ?? {}) as { width?: unknown; height?: unknown }
  if (typeof data.width !== "number" || typeof data.height !== "number" || data.width <= 0 || data.height <= 0) return DEFAULT_ASPECT
  return data.width / data.height
}

/**
 * The player's box in the aspect, never under 320 px wide. Without a height it is as wide as the container; with one
 * it is the largest box that fits both, with `controllerHeight` left under it.
 */
export function playerSize(
  container: { width: number; height?: number },
  aspect = DEFAULT_ASPECT,
  controllerHeight = 0,
): { width: number; height: number } {
  let width = container.width
  if (container.height !== undefined) width = Math.min(width, (container.height - controllerHeight) * aspect)
  width = Math.max(MIN_WIDTH, Math.floor(width))
  return { width, height: Math.round(width / aspect) }
}

/** The speed button's steps, in the order it goes through them. */
export const REPLAY_SPEEDS = [1, 2, 4, 8] as const

export function nextSpeed(speed: number): number {
  const index = REPLAY_SPEEDS.indexOf(speed as (typeof REPLAY_SPEEDS)[number])
  return REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.length] ?? 1
}

/** The strip's highlighted frame; null with no frames. */
export function activeFrame(frames: ReplayFrame[], currentMs: number): number | null {
  return frames.length === 0 ? null : frameIndexAt(frames, currentMs)
}
