import { createContext } from "react"
import { seekSeconds } from "../../lib/timeline"

/**
 * The report's video, for parts of the page outside the player: a "0:52" in a comment seeks it there. Null on a
 * screenshot report, and anywhere outside the report page.
 */
export const ReportVideoContext = createContext<{ seek(ms: number): void; durationMs: number } | null>(null)

/**
 * Plays the video from `ms` and brings it into view: on a phone the player is far above the comments, so only
 * seeking would look like nothing happened.
 */
export function playAt(video: HTMLVideoElement | null, ms: number, durationMs: number): void {
  if (!video) return
  video.currentTime = seekSeconds(ms, durationMs)
  video.play()?.catch(() => {})
  video.scrollIntoView?.({ block: "center", behavior: "smooth" })
}
