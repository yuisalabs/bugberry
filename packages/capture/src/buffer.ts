import type { CaptureEvent } from "./events"
import { BUFFER_MAX_AGE_MS, BUFFER_MAX_EVENTS, MAX_RESOURCE_EVENTS } from "./limits"

const isResource = (event: CaptureEvent) => event.kind === "resource"

/** Drops the oldest resources until at most `keep` are left. */
function dropResources(events: CaptureEvent[], keep: number): CaptureEvent[] {
  let excess = events.filter(isResource).length - keep
  if (excess <= 0) return events
  return events.filter((event) => !(isResource(event) && excess-- > 0))
}

export interface EventBuffer {
  push(event: CaptureEvent): void
  /** Whether this exact event object is still kept (not dropped for age or count). */
  has(event: CaptureEvent): boolean
  /** Deep copy of the retained events, ordered by `t`. */
  snapshot(): CaptureEvent[]
  clear(): void
  readonly size: number
}

/**
 * Keeps the most recent events in memory only. Events stay mutable after `push` (a network
 * event's response body is filled in once it has been read), so snapshots copy at read time.
 */
export function createEventBuffer(
  options: { maxAgeMs?: number; maxEvents?: number; now?: () => number } = {},
): EventBuffer {
  const maxAgeMs = options.maxAgeMs ?? BUFFER_MAX_AGE_MS
  const maxEvents = options.maxEvents ?? BUFFER_MAX_EVENTS
  const now = options.now ?? Date.now
  let events: CaptureEvent[] = []

  const prune = () => {
    const cutoff = now() - maxAgeMs
    if (events.some((event) => event.t < cutoff)) events = events.filter((event) => event.t >= cutoff)
    events = dropResources(events, MAX_RESOURCE_EVENTS)
    // Over the limit, resources go first; logs, errors and actions only when nothing else is left.
    if (events.length > maxEvents) events = dropResources(events, Math.max(0, events.filter(isResource).length - (events.length - maxEvents)))
    if (events.length > maxEvents) events = events.slice(events.length - maxEvents)
  }

  return {
    push(event) {
      events.push(event)
      prune()
    },
    has(event) {
      prune()
      return events.includes(event)
    },
    snapshot() {
      prune()
      return structuredClone(events).sort((a, b) => a.t - b.t)
    },
    clear() {
      events = []
    },
    get size() {
      return events.length
    },
  }
}
