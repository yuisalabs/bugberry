import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query"
import { api } from "./client"
import { nextReportsPage, type ReportFilterQuery, reportsPageQuery } from "./report-feed"
import { REPORT_LIST_REFRESH_MS, REPORT_LIST_STALE_MS } from "../features/reports/queries"

export const queries = {
  /** A report list fetched a part at a time as it scrolls; a refresh fetches again every part already shown. */
  reportFeed: (workspaceId: string, filters: ReportFilterQuery) =>
    infiniteQueryOptions({
      queryKey: ["reports", workspaceId, filters],
      queryFn: ({ pageParam }) => api.reports(workspaceId, reportsPageQuery(filters, pageParam)),
      initialPageParam: 1,
      getNextPageParam: nextReportsPage,
      placeholderData: keepPreviousData,
      staleTime: REPORT_LIST_STALE_MS,
      refetchInterval: REPORT_LIST_REFRESH_MS,
    }),
  /**
   * How many reports a list holds before any filter: one report fetched for its total. Kept under "reports" so
   * whatever refreshes the lists refreshes this too.
   */
  reportCount: (workspaceId: string, projectId?: string) =>
    queryOptions({
      queryKey: ["reports", workspaceId, "count", projectId ?? null],
      queryFn: async () =>
        (await api.reports(workspaceId, { ...(projectId ? { projectId } : {}), sort: "newest", page: 1, perPage: 1 })).total,
      staleTime: REPORT_LIST_STALE_MS,
    }),
  /** How many reports each status holds under the list's other filters, for the status chips. */
  reportStatusCounts: (workspaceId: string, filters: ReportFilterQuery) =>
    queryOptions({
      queryKey: ["reports", workspaceId, "status-counts", { ...filters, status: undefined }],
      queryFn: () => api.reportCounts(workspaceId, { ...filters, status: undefined }),
      staleTime: REPORT_LIST_STALE_MS,
      placeholderData: keepPreviousData,
    }),
  report: (id: string) => queryOptions({ queryKey: ["report", id], queryFn: () => api.report(id) }),
  share: (slug: string) => queryOptions({ queryKey: ["share", slug], queryFn: () => api.share(slug), retry: false }),
  /** Teammates reply while the page sits in another tab, so coming back to it fetches the discussion again. */
  comments: (reportId: string) =>
    queryOptions({ queryKey: ["comments", reportId], queryFn: () => api.comments(reportId), refetchOnWindowFocus: true }),
  /** The report's activity lines; fetched only while "All activity" is on, and again on coming back to the page. */
  activity: (reportId: string) =>
    queryOptions({ queryKey: ["activity", reportId], queryFn: () => api.activity(reportId), refetchOnWindowFocus: true }),
  reportTrackers: (reportId: string) =>
    queryOptions({ queryKey: ["report-trackers", reportId], queryFn: () => api.reportTrackers(reportId) }),
}
