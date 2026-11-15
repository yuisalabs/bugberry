import { listedCount, type ReportStatus } from "@bugberry/shared"
import type { ReportCounts, ReportList, ReportListItem, ReportsQuery } from "../queries"

/** Reports fetched per part as the list scrolls: three rows of the three-column grid. */
export const REPORTS_PAGE_SIZE = 9

/** A report list's filters and order; the feed adds which part to fetch. */
export type ReportFilterQuery = Omit<ReportsQuery, "cursor" | "perPage">

/** The request for one part of the list: the first without a cursor, each next one with the cursor the part before gave. */
export function reportsPageQuery(filters: ReportFilterQuery, cursor: string | null): ReportsQuery {
  return { ...filters, perPage: REPORTS_PAGE_SIZE, ...(cursor ? { cursor } : {}) }
}

/** The cursor of the part after `last`, or undefined once every report has been fetched. */
export function nextReportsCursor(last: ReportList): string | undefined {
  return last.nextCursor ?? undefined
}

/**
 * Every fetched part as one list. A refresh fetches the parts again one after another, and a report that moved
 * between two of them meanwhile (its priority changed, say) can come back in both; it is listed once, where it
 * was first seen.
 */
export function feedItems(pages: readonly ReportList[]): ReportListItem[] {
  const seen = new Set<string>()
  return pages.flatMap((page) =>
    page.items.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    }),
  )
}

/**
 * How many reports the list holds, from the status counts query. Null while that query has no answer for these
 * filters: it keeps showing the answer for the filters before, and the list itself arrives sooner.
 */
export function feedTotal(
  counts: { data: ReportCounts | undefined; isPlaceholderData: boolean },
  statuses?: readonly ReportStatus[],
): number | null {
  return counts.data && !counts.isPlaceholderData ? listedCount(counts.data, statuses) : null
}

/** What the list page shows: the reports so far, and how fetching the rest is going. */
export interface ReportFeed {
  items: ReportListItem[]
  /** How many reports the list holds, which the server counts apart from the list; null until that answer is in. */
  total: number | null
  hasMore: boolean
  loadingMore: boolean
  /** The last part failed; it is not asked for again until the person says so. */
  moreFailed: boolean
}
