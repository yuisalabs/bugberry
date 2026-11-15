import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { reportQueries } from "../queries"
import { feedItems, feedTotal, type ReportFilterQuery } from "./report-feed"
import type { ReportListState } from "./ReportsView"

/**
 * A report list wired to the API: its parts as they are fetched, its total from the status counts, and the two things
 * the page asks of it. Nothing is fetched until `enabled`, which waits for the workspace.
 */
export function useReportFeed(workspaceId: string, filters: ReportFilterQuery, enabled: boolean) {
  const reports = useInfiniteQuery({ ...reportQueries.reportFeed(workspaceId, filters), enabled })
  // Each status's count under the other filters: the phone's status chips, and added up, how many reports the list holds.
  const statusCounts = useQuery({ ...reportQueries.reportStatusCounts(workspaceId, filters), enabled })
  const { isFetching, isFetchingNextPage, refetch } = reports
  const pages = reports.data?.pages ?? []

  // Fresh links are fetched once whatever is being fetched has arrived: refetching at once would cancel a part on
  // its way, and every failed preview would start the refetch over.
  const [previewsFailed, setPreviewsFailed] = useState(false)
  useEffect(() => {
    if (!previewsFailed || isFetching) return
    setPreviewsFailed(false)
    void refetch()
  }, [previewsFailed, isFetching, refetch])

  const list: ReportListState = reports.isPending
    ? "loading"
    : reports.isError && pages.length === 0
      ? { error: reports.error, retry: () => void refetch() }
      : {
          items: feedItems(pages),
          total: feedTotal(statusCounts, filters.status),
          hasMore: reports.hasNextPage,
          loadingMore: isFetchingNextPage,
          moreFailed: reports.isFetchNextPageError,
          refreshing: isFetching && !isFetchingNextPage,
        }

  return {
    list,
    statusCounts: statusCounts.data ?? null,
    /** The list's first part came back with no report. */
    empty: pages[0]?.items.length === 0,
    /** One part at a time: the end of the list stops asking while a part loads, and this guards it too. */
    loadMore() {
      if (reports.hasNextPage && !isFetchingNextPage) void reports.fetchNextPage({ cancelRefetch: false })
    },
    /** A preview failed to load, most likely because its signed link expired. */
    refreshPreviews: () => setPreviewsFailed(true),
  }
}
