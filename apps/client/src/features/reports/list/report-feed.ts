import type { ReportList, ReportListItem, ReportsQuery } from "../queries"

/** Reports fetched per part as the list scrolls: three rows of the three-column grid. */
export const REPORTS_PAGE_SIZE = 9

/** A report list's filters and order; the feed adds which part to fetch. */
export type ReportFilterQuery = Omit<ReportsQuery, "page" | "perPage">

/** The request for one part of the list. */
export function reportsPageQuery(filters: ReportFilterQuery, page: number): ReportsQuery {
  return { ...filters, page, perPage: REPORTS_PAGE_SIZE }
}

/** The part after `last`, or undefined once every report has been fetched. */
export function nextReportsPage(last: ReportList): number | undefined {
  return last.page * last.perPage < last.total ? last.page + 1 : undefined
}

/**
 * Every fetched part as one list. Parts are cut by position, so a report that arrived while scrolling pushes
 * the last one of a part into the next; it is listed once, where it was first seen.
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

/** What the list page shows: the reports so far, and how fetching the rest is going. */
export interface ReportFeed {
  items: ReportListItem[]
  total: number
  hasMore: boolean
  loadingMore: boolean
  /** The last part failed; it is not asked for again until the person says so. */
  moreFailed: boolean
}
