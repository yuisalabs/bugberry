import type { CaptureEvent } from "./events"
import { BUFFER_MAX_AGE_MS, BUFFER_MAX_EVENTS, MAX_RESOURCE_EVENTS, MAX_SDK_EVENTS } from "./limits"

const countOf = (events: CaptureEvent[], kind: CaptureEvent["kind"]) => events.filter((event) => event.kind === kind).length

/** Drops the oldest events of `kind` until at most `keep` are left. */
function dropKind(events: CaptureEvent[], kind: CaptureEvent["kind"], keep: number): CaptureEvent[] {
  let excess = countOf(events, kind) - keep
  if (excess <= 0) return events
  return events.filter((event) => !(event.kind === kind && excess-- > 0))
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
    events = dropKind(events, "resource", MAX_RESOURCE_EVENTS)
    events = dropKind(events, "sdk", MAX_SDK_EVENTS)
    // Over the limit, resources go first, then the app's SDK logs; logs, errors and actions only when nothing else is left.
    for (const kind of ["resource", "sdk"] as const) {
      if (events.length > maxEvents) events = dropKind(events, kind, Math.max(0, countOf(events, kind) - (events.length - maxEvents)))
    }
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
