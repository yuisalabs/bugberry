import type { OptionList } from "../../features/integrations/queries"
import type { ReportFilterQuery } from "../../features/reports/list/report-feed"

/**
 * Every query key, in one place. The values are the ones the code always used, so each invalidation still reaches
 * the same queries: `.all` keys are the prefixes invalidated to refresh every query under them.
 */
export const qk = {
  me: ["me"],
  myLimits: ["my-limits"],
  clientConfig: ["client-config"],
  authMethods: ["auth-methods"],
  signInMethods: ["sign-in-methods"],
  mcpTokens: ["mcp-tokens"],
  oauthApps: ["oauth-apps"],
  oauthClient: (clientId: string) => ["oauth-client", clientId],
  notifications: ["notifications"],
  onboarding: {
    all: ["onboarding"],
    of: (workspaceId: string) => ["onboarding", workspaceId],
  },
  workspaces: ["workspaces"],
  members: (workspaceId: string) => ["members", workspaceId],
  invitations: (workspaceId: string) => ["invitations", workspaceId],
  myInvitations: ["my-invitations"],
  invitation: (token: string) => ["invitation", token],
  domainWorkspaces: ["domain-workspaces"],
  sharedInvite: (code: string) => ["shared-invite", code],
  workspaceLimits: {
    all: ["workspace-limits"],
    of: (workspaceId: string) => ["workspace-limits", workspaceId],
  },
  workspaceAccess: (workspaceId: string) => ["workspace-access", workspaceId],
  joinRequests: (workspaceId: string) => ["join-requests", workspaceId],
  projects: {
    all: ["projects"],
    of: (workspaceId: string) => ["projects", workspaceId],
    overview: (workspaceId: string) => ["projects", workspaceId, "overview"],
  },
  integrations: (projectId: string) => ["integrations", projectId],
  connections: (workspaceId: string) => ["connections", workspaceId],
  connectionOptions: (workspaceId: string, id: string, list: OptionList, q: string, parent: string) =>
    ["connection-options", workspaceId, id, list, q, parent],
  ai: (workspaceId: string) => ["ai", workspaceId],
  reports: {
    all: ["reports"],
    feed: (workspaceId: string, filters: ReportFilterQuery) => ["reports", workspaceId, filters],
    count: (workspaceId: string, projectId?: string) => ["reports", workspaceId, "count", projectId ?? null],
    statusCounts: (workspaceId: string, filters: ReportFilterQuery) =>
      ["reports", workspaceId, "status-counts", { ...filters, status: undefined }],
  },
  report: (id: string) => ["report", id],
  share: (slug: string) => ["share", slug],
  comments: (reportId: string) => ["comments", reportId],
  activity: (reportId: string) => ["activity", reportId],
  reportTrackers: (reportId: string) => ["report-trackers", reportId],
  debugger: (reportId: string) => ["debugger", reportId],
}
