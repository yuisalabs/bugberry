import type { CaptureType, Priority, ReportStatus, Visibility } from "@bugberry/shared"
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"
import { nextReportsPage, type ReportFilterQuery, reportsPageQuery } from "./list/report-feed"

/**
 * Report lists carry signed preview links that expire (READ_URL_TTL_SECONDS, an hour by default), so a
 * list left open is refreshed well before that.
 */
export const REPORT_LIST_REFRESH_MS = 5 * 60_000

/**
 * A report list is fresh for a minute: switching back to the window within that time doesn't fetch every part
 * shown again. Changes made here invalidate it at once.
 */
export const REPORT_LIST_STALE_MS = 60_000

export interface ReportsQuery {
  /** A project id, "none" for reports without a project, or absent for all reports. */
  projectId?: string
  status?: ReportStatus[]
  priority?: Priority[]
  assigneeId?: string
  reporterId?: string
  captureType?: CaptureType
  q?: string
  sort: "newest" | "oldest" | "priority"
  page: number
  perPage: number
}

export interface ReportPatch {
  title?: string
  status?: ReportStatus
  priority?: Priority
  visibility?: Visibility
  assigneeId?: string | null
  /** Null takes the report out of its project. */
  projectId?: string | null
}

export const reports = (workspaceId: string, query: ReportsQuery) => unwrap(eden.api.reports.get({ query: { workspaceId, ...query } }))
export const reportCounts = (workspaceId: string, query: Omit<ReportsQuery, "page" | "perPage">) =>
  unwrap(eden.api.reports.counts.get({ query: { workspaceId, ...query } }))
export const report = (id: string) => unwrap(eden.api.reports({ id }).get())
export const updateReport = (id: string, patch: ReportPatch) => unwrap(eden.api.reports({ id }).patch(patch))
export const deleteReport = (id: string) => unwrap(eden.api.reports({ id }).delete())
export const reportTrackers = (reportId: string) => unwrap(eden.api.reports({ id: reportId }).trackers.get())
export const sendToTracker = (reportId: string, integrationId: string) =>
  unwrap(eden.api.reports({ id: reportId }).trackers({ integrationId }).send.post())
export const regenerateShare = (id: string) => unwrap(eden.api.reports({ id }).share.regenerate.post())
export const share = (slug: string) => unwrap(eden.api.share({ slug }).get())

export type ReportList = Awaited<ReturnType<typeof reports>>
export type ReportCounts = Awaited<ReturnType<typeof reportCounts>>
export type ReportListItem = ReportList["items"][number]
export type ReportDetail = Awaited<ReturnType<typeof report>>
export type ReportTrackers = Awaited<ReturnType<typeof reportTrackers>>
export type TrackerLink = ReportTrackers["links"][number]

export const reportQueries = {
  /** A report list fetched a part at a time as it scrolls; a refresh fetches again every part already shown. */
  reportFeed: (workspaceId: string, filters: ReportFilterQuery) =>
    infiniteQueryOptions({
      queryKey: qk.reports.feed(workspaceId, filters),
      queryFn: ({ pageParam }) => reports(workspaceId, reportsPageQuery(filters, pageParam)),
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
      queryKey: qk.reports.count(workspaceId, projectId),
      queryFn: async () => (await reports(workspaceId, { ...(projectId ? { projectId } : {}), sort: "newest", page: 1, perPage: 1 })).total,
      staleTime: REPORT_LIST_STALE_MS,
    }),
  /** How many reports each status holds under the list's other filters, for the status chips. */
  reportStatusCounts: (workspaceId: string, filters: ReportFilterQuery) =>
    queryOptions({
      queryKey: qk.reports.statusCounts(workspaceId, filters),
      queryFn: () => reportCounts(workspaceId, { ...filters, status: undefined }),
      staleTime: REPORT_LIST_STALE_MS,
      placeholderData: keepPreviousData,
    }),
  report: (id: string) => queryOptions({ queryKey: qk.report(id), queryFn: () => report(id) }),
  reportTrackers: (reportId: string) => queryOptions({ queryKey: qk.reportTrackers(reportId), queryFn: () => reportTrackers(reportId) }),
  share: (slug: string) => queryOptions({ queryKey: qk.share(slug), queryFn: () => share(slug), retry: false }),
}
