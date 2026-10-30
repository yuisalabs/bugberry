import type { CaptureEvent } from "@bugberry/capture"
import { withinBudget } from "../capture/capture-flow"

/** One document's capture buffer, as it was when the page went away (or when the recording stopped). */
export interface PageCaptureRecord {
  documentId: string
  /** The tab it was open in; absent on pages stored by older versions, which were all the recorded tab's. */
  tabId?: number
  events: CaptureEvent[]
  incomplete: string[]
}

/** A recording across several pages keeps at most this many events, the same cap the dashboard reads. */
export const MAX_MERGED_EVENTS = 5000

/** Drops the oldest resources first, then the oldest of anything, until at most `max` are left. */
function capEvents(events: CaptureEvent[], max: number): CaptureEvent[] {
  let excess = events.length - max
  if (excess <= 0) return events
  const withoutOldResources = events.filter((event) => !(event.kind === "resource" && excess-- > 0))
  return withoutOldResources.slice(Math.max(0, withoutOldResources.length - max))
}

/**
 * Keeps the pages stored during a recording within MAX_MERGED_EVENTS and the payload budget, so a page
 * that reloads itself again and again cannot grow the draft without end. The newest page is kept whole.
 */
export function capPages(pages: readonly PageCaptureRecord[]): PageCaptureRecord[] {
  const all = pages.flatMap((page) => page.events)
  const kept = new Set(withinBudget(capEvents(all, MAX_MERGED_EVENTS)))
  return pages
    .map((page) => ({ ...page, events: page.events.filter((event) => kept.has(event)) }))
    .filter((page, index) => page.events.length > 0 || index === pages.length - 1)
}

/**
 * Every page's events in one timeline; `current` (the pages open at stop, one per tab) replaces the stored
 * copy of their documents.
 */
export function mergePages(
  stored: readonly PageCaptureRecord[],
  current: PageCaptureRecord | readonly PageCaptureRecord[] | null,
): { events: CaptureEvent[]; incomplete: string[] } {
  const pages = new Map<string, PageCaptureRecord>()
  for (const page of stored) pages.set(page.documentId, page)
  for (const page of current === null ? [] : "documentId" in current ? [current] : current) pages.set(page.documentId, page)
  const events = [...pages.values()].flatMap((page) => page.events).sort((a, b) => a.t - b.t)
  const incomplete = [...new Set([...pages.values()].flatMap((page) => page.incomplete))]
  return { events: withinBudget(capEvents(events, MAX_MERGED_EVENTS)), incomplete }
}
