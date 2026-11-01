import { type CustomFields, type MetadataSnapshot, NO_METADATA } from "@bugberry/capture"
import type { PageCaptureRecord } from "./page-merge"

/**
 * One snapshot per report. `final` is the page open at stop (or the screenshot's page; null when it could not
 * be read), `earlier` the recorded tab's flushed pages, oldest first. The final page's fields win; without
 * them, the latest earlier page that had fields is used, with its URL and flush time, and the final page's error still shows.
 */
export function pickCustomFields(
  final: { metadata: MetadataSnapshot } | null,
  earlier: readonly PageCaptureRecord[],
  now: number,
): CustomFields | undefined {
  const last = final?.metadata ?? NO_METADATA
  if (last.fields) return { ...last, url: null, t: now }
  const fallback = earlier.findLast((page) => page.metadata?.fields)
  if (fallback?.metadata) return { ...fallback.metadata, error: last.error, url: fallback.url ?? null, t: fallback.at ?? now }
  if (last.error) return { ...last, url: null, t: now }
  return undefined
}
