/** What a seeker needs of a <video>. */
export interface Seekable extends EventTarget {
  currentTime: number
}

/** A seek that runs longer than this no longer holds the next one back (a "seeked" that never came). */
const STUCK_MS = 1000

/**
 * Seeks one at a time. A recording seeks in 50–150 ms, while a dragged handle moves every frame, and a new seek
 * cancels the one running: seeking at every move kept the video decoding and never showing a frame. Here a seek
 * waits for the running one to end, and only the latest of those that waited goes.
 */
export function createSeeker(video: Seekable, now: () => number = () => performance.now()) {
  let runningSince: number | null = null
  let waiting: number | null = null

  const start = (seconds: number) => {
    runningSince = now()
    video.currentTime = seconds
  }
  video.addEventListener("seeked", () => {
    runningSince = null
    if (waiting === null) return
    const next = waiting
    waiting = null
    start(next)
  })

  return {
    seek(seconds: number) {
      if (runningSince !== null && now() - runningSince < STUCK_MS) waiting = seconds
      else start(seconds)
    },
  }
}
