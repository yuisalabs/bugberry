import type { OptionList } from "../api"
import type { ReportFilterQuery } from "../report-feed"

/**
 * Every query key, in one place. The values are the ones the code always used, so each invalidation still reaches
 * the same queries: `.all` keys are the prefixes invalidated to refresh every query under them.
 */
export const qk = {
  me: ["me"] as const,
  myLimits: ["my-limits"] as const,
  clientConfig: ["client-config"] as const,
  authMethods: ["auth-methods"] as const,
  signInMethods: ["sign-in-methods"] as const,
  mcpTokens: ["mcp-tokens"] as const,
  oauthApps: ["oauth-apps"] as const,
  oauthClient: (clientId: string) => ["oauth-client", clientId] as const,
  notifications: ["notifications"] as const,
  onboarding: {
    all: ["onboarding"] as const,
    of: (workspaceId: string) => ["onboarding", workspaceId] as const,
  },
  workspaces: ["workspaces"] as const,
  members: (workspaceId: string) => ["members", workspaceId] as const,
  invitations: (workspaceId: string) => ["invitations", workspaceId] as const,
  myInvitations: ["my-invitations"] as const,
  invitation: (token: string) => ["invitation", token] as const,
  domainWorkspaces: ["domain-workspaces"] as const,
  sharedInvite: (code: string) => ["shared-invite", code] as const,
  workspaceLimits: {
    all: ["workspace-limits"] as const,
    of: (workspaceId: string) => ["workspace-limits", workspaceId] as const,
  },
  workspaceAccess: (workspaceId: string) => ["workspace-access", workspaceId] as const,
  joinRequests: (workspaceId: string) => ["join-requests", workspaceId] as const,
  projects: {
    all: ["projects"] as const,
    of: (workspaceId: string) => ["projects", workspaceId] as const,
    overview: (workspaceId: string) => ["projects", workspaceId, "overview"] as const,
  },
  integrations: (projectId: string) => ["integrations", projectId] as const,
  connections: (workspaceId: string) => ["connections", workspaceId] as const,
  connectionOptions: (workspaceId: string, id: string, list: OptionList, q: string, parent: string) =>
    ["connection-options", workspaceId, id, list, q, parent] as const,
  ai: (workspaceId: string) => ["ai", workspaceId] as const,
  reports: {
    all: ["reports"] as const,
    feed: (workspaceId: string, filters: ReportFilterQuery) => ["reports", workspaceId, filters] as const,
    count: (workspaceId: string, projectId?: string) => ["reports", workspaceId, "count", projectId ?? null] as const,
    statusCounts: (workspaceId: string, filters: ReportFilterQuery) =>
      ["reports", workspaceId, "status-counts", { ...filters, status: undefined }] as const,
  },
  report: (id: string) => ["report", id] as const,
  share: (slug: string) => ["share", slug] as const,
  comments: (reportId: string) => ["comments", reportId] as const,
  activity: (reportId: string) => ["activity", reportId] as const,
  reportTrackers: (reportId: string) => ["report-trackers", reportId] as const,
  debugger: (reportId: string) => ["debugger", reportId] as const,
}
