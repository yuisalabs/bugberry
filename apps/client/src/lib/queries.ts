import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query"
import { api } from "./client"
import { nextReportsPage, type ReportFilterQuery, reportsPageQuery } from "./report-feed"

/**
 * Report lists carry signed preview links that expire (READ_URL_TTL_SECONDS, an hour by default), so a
 * list left open is refreshed well before that.
 */
export const REPORT_LIST_REFRESH_MS = 5 * 60_000

/** How often the bell asks for new mentions; it also asks when the window regains focus. */
export const NOTIFICATIONS_REFRESH_MS = 30_000

export const queries = {
  me: () => queryOptions({ queryKey: ["me"], queryFn: () => api.me(), staleTime: 60_000 }),
  clientConfig: () => queryOptions({ queryKey: ["client-config"], queryFn: () => api.clientConfig(), staleTime: Infinity }),
  authMethods: () => queryOptions({ queryKey: ["auth-methods"], queryFn: () => api.authMethods(), staleTime: Infinity }),
  workspaces: () => queryOptions({ queryKey: ["workspaces"], queryFn: () => api.workspaces(), staleTime: 60_000 }),
  projects: (workspaceId: string) =>
    queryOptions({ queryKey: ["projects", workspaceId], queryFn: () => api.projects(workspaceId) }),
  members: (workspaceId: string) =>
    queryOptions({ queryKey: ["members", workspaceId], queryFn: () => api.members(workspaceId) }),
  invitations: (workspaceId: string) =>
    queryOptions({ queryKey: ["invitations", workspaceId], queryFn: () => api.invitations(workspaceId) }),
  myInvitations: () => queryOptions({ queryKey: ["my-invitations"], queryFn: () => api.myInvitations() }),
  domainWorkspaces: () => queryOptions({ queryKey: ["domain-workspaces"], queryFn: () => api.domainWorkspaces() }),
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
      refetchInterval: REPORT_LIST_REFRESH_MS,
    }),
  report: (id: string) => queryOptions({ queryKey: ["report", id], queryFn: () => api.report(id) }),
  share: (slug: string) => queryOptions({ queryKey: ["share", slug], queryFn: () => api.share(slug), retry: false }),
  notifications: () =>
    queryOptions({
      queryKey: ["notifications"],
      queryFn: () => api.notifications(),
      refetchInterval: NOTIFICATIONS_REFRESH_MS,
      refetchOnWindowFocus: true,
    }),
  comments: (reportId: string) => queryOptions({ queryKey: ["comments", reportId], queryFn: () => api.comments(reportId) }),
  reportTrackers: (reportId: string) =>
    queryOptions({ queryKey: ["report-trackers", reportId], queryFn: () => api.reportTrackers(reportId) }),
  integrations: (projectId: string) =>
    queryOptions({ queryKey: ["integrations", projectId], queryFn: () => api.integrations(projectId) }),
}
