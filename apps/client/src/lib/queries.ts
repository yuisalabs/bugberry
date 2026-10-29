import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query"
import { api } from "./client"
import { nextReportsPage, type ReportFilterQuery, reportsPageQuery } from "./report-feed"

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

export const queries = {
  workspaces: () => queryOptions({ queryKey: ["workspaces"], queryFn: () => api.workspaces(), staleTime: 60_000 }),
  members: (workspaceId: string) =>
    queryOptions({ queryKey: ["members", workspaceId], queryFn: () => api.members(workspaceId) }),
  invitations: (workspaceId: string) =>
    queryOptions({ queryKey: ["invitations", workspaceId], queryFn: () => api.invitations(workspaceId) }),
  myInvitations: () => queryOptions({ queryKey: ["my-invitations"], queryFn: () => api.myInvitations() }),
  domainWorkspaces: () => queryOptions({ queryKey: ["domain-workspaces"], queryFn: () => api.domainWorkspaces() }),
  /** Under ACCOUNT_LIMITS: screenshots and recordings kept, and no inviting. Refreshed with the report list. */
  workspaceLimits: (workspaceId: string) =>
    queryOptions({
      queryKey: ["workspace-limits", workspaceId],
      queryFn: () => api.workspaceLimits(workspaceId),
      refetchInterval: REPORT_LIST_REFRESH_MS,
    }),
  workspaceAccess: (workspaceId: string) =>
    queryOptions({ queryKey: ["workspace-access", workspaceId], queryFn: () => api.workspaceAccess(workspaceId) }),
  /** Admins see waiting requests as a count next to Members, so the list is refreshed every minute. */
  joinRequests: (workspaceId: string) =>
    queryOptions({ queryKey: ["join-requests", workspaceId], queryFn: () => api.joinRequests(workspaceId), refetchInterval: 60_000 }),
  invitation: (token: string) =>
    queryOptions({ queryKey: ["invitation", token], queryFn: () => api.invitation(token), retry: false }),
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
  ai: (workspaceId: string) => queryOptions({ queryKey: ["ai", workspaceId], queryFn: () => api.aiSetup(workspaceId) }),
}
