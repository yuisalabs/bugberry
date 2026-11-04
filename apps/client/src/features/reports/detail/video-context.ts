import { createContext } from "react"
import { seekSeconds } from "../debugger/timeline"

/**
 * The report's recording, for parts of the page outside the player: a "0:52" in a comment seeks it there. Null on a
 * screenshot report, and anywhere outside the report page.
 */
export const ReportVideoContext = createContext<{ seek(ms: number): void; durationMs: number } | null>(null)

/** The video or the replay, as playAt drives it. */
export interface Playable {
  seek(ms: number): void
  play(): void
  /** Brought into view once it plays. */
  element: Element | null
}

/**
 * Plays the recording from `ms` and brings it into view: on a phone the player is far above the comments, so only
 * seeking would look like nothing happened.
 */
export function playAt(player: Playable | null, ms: number, durationMs: number): void {
  if (!player) return
  player.seek(seekSeconds(ms, durationMs) * 1000)
  player.play()
  player.element?.scrollIntoView?.({ block: "center", behavior: "smooth" })
}

export function playableVideo(video: HTMLVideoElement | null): Playable | null {
  if (!video) return null
  return {
    seek: (ms) => {
      video.currentTime = ms / 1000
    },
    play: () => void video.play()?.catch(() => {}),
    element: video,
  }
}
