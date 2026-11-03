import type { ReplayEvent } from "@bugberry/shared"
import type { ReplaySnapshot } from "../shared/messages"

const META = 4

/**
 * The page's rolling replay: segments that each open with rrweb's Meta event (a checkout), the newest `segments`
 * kept. Frames are custom events inside them, so one eviction rule covers the DOM and the screenshots.
 */
export interface ReplayBuffer {
  push(event: ReplayEvent, isCheckout: boolean): void
  snapshot(): ReplaySnapshot
  /** A segment was dropped for the byte cap since the last checkout that fit: a capture is shorter than the window. */
  degraded(): boolean
  /** The only segment left is over the cap; a fresh checkout lets the next push drop it. */
  overCap(): boolean
  /** When the newest segment started; null before the first. */
  lastCheckoutAt(): number | null
  clear(): void
}

export function eventBytes(event: ReplayEvent): number {
  return JSON.stringify(event).length
}

interface Segment {
  events: ReplayEvent[]
  bytes: number
}

export function createReplayBuffer(options: { maxBytes: number; segments?: number }): ReplayBuffer {
  const keep = options.segments ?? 2
  let segments: Segment[] = []
  let bytes = 0
  let degraded = false

  const dropOldest = () => {
    const gone = segments.shift()
    if (gone) bytes -= gone.bytes
  }

  return {
    // A segment opens at a Meta event: rrweb flags both the Meta and the FullSnapshot of a checkout, and its very
    // first Meta is not flagged at all.
    push(event) {
      const size = eventBytes(event)
      if (event.type === META) {
        segments.push({ events: [], bytes: 0 })
        degraded = false
        while (segments.length > keep) dropOldest()
      }
      const current = segments.at(-1)
      if (!current) return
      current.events.push(event)
      current.bytes += size
      bytes += size
      while (bytes > options.maxBytes && segments.length > 1) {
        dropOldest()
        degraded = true
      }
    },
    snapshot() {
      const events = segments.flatMap((segment) => segment.events)
      return { events, since: events[0]?.timestamp ?? 0, bytes, degraded }
    },
    degraded: () => degraded,
    overCap: () => bytes > options.maxBytes,
    lastCheckoutAt: () => segments.at(-1)?.events[0]?.timestamp ?? null,
    clear() {
      segments = []
      bytes = 0
      degraded = false
    },
  }
}
