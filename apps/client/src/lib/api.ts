import { treaty } from "@elysiajs/eden"
import type { App } from "@bugberry/api"
import type {
  CaptureType,
  ConnectionSettings,
  IntegrationProvider,
  Priority,
  ReportStatus,
  UseTarget,
  Visibility,
  WorkspaceRole,
} from "@bugberry/shared"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The whole error body, for answers that carry more than code and message (use_share_link). */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "ApiError"
  }
}

interface EdenResult<T> {
  data: T | null
  error: { status: unknown; value: unknown } | null
}

const NETWORK_MESSAGE = "BugBerry can't be reached. Check your connection and try again."

/** Resolves an Eden call to its data, or throws an ApiError carrying the server's `{ code, message }`. */
export async function unwrap<T>(request: Promise<EdenResult<T>>): Promise<NonNullable<T>> {
  let result: EdenResult<T>
  try {
    result = await request
  } catch {
    throw new ApiError(0, "network", NETWORK_MESSAGE)
  }
  if (result.error) {
    // Eden reports a failed fetch as status 503 carrying the thrown Error, not a server response.
    if (result.error.value instanceof Error) throw new ApiError(0, "network", NETWORK_MESSAGE)
    const body = (result.error.value ?? {}) as { code?: unknown; message?: unknown }
    throw new ApiError(
      Number(result.error.status) || 0,
      typeof body.code === "string" ? body.code : "error",
      typeof body.message === "string" ? body.message : "The request failed. Try again.",
      typeof body === "object" ? (body as Record<string, unknown>) : {},
    )
  }
  if (result.data === null || result.data === undefined) throw new ApiError(0, "empty", "The server sent an empty response")
  return result.data as NonNullable<T>
}

/** Which sign-in methods the server enables (GET /api/auth-methods). */
export type SignInMethod = "google" | "github" | "gitlab" | "email"

/** Public settings the dashboard reads before anyone signs in. */
export interface ClientConfig {
  extensionInstallUrl: string | null
  maxUploadMb: number
  /** False on self-hosted servers: the marketing pages go to sign-in there. */
  publicSite: boolean
}

export interface AuthMethods {
  github: boolean
  gitlab: boolean
  google: boolean
  emailOtp: boolean
}

export interface ProjectInput {
  name: string
  slug: string
  urlPatterns: string[]
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

/** A workspace connection as an admin saves it; the secret is sealed on the server and never comes back. */
export interface ConnectionInput {
  provider: IntegrationProvider
  name: string
  settings: ConnectionSettings
  secret?: string
}

export interface ConnectionPatch {
  name?: string
  settings?: ConnectionSettings
  /** Empty keeps the current secret. */
  secret?: string
}

/** What a connection can list for a project to pick from. */
export type OptionList = "targets" | "labels" | "issueTypes" | "taskLists"

/** A project's use of a connection; its target is picked from the connection's lists. */
export interface IntegrationInput {
  connectionId: string
  target: UseTarget
  autoSend?: boolean
}

/** Only labels and auto-send change; a different target is a new use. */
export interface IntegrationPatch {
  labels?: string[]
  autoSend?: boolean
}

export function createApi(origin: string = window.location.origin, fetcher: typeof fetch = fetch) {
  const { api } = treaty<App>(origin, { fetcher })
  return {
    me: () => unwrap(api.me.get()),
    myLimits: () => unwrap(api.me.limits.get()),
    switchWorkspace: (workspaceId: string) => unwrap(api.me.workspace.put({ workspaceId })),
    workspaces: () => unwrap(api.workspaces.get()),
    createWorkspace: (name: string, slug?: string) => unwrap(api.workspaces.post(slug === undefined ? { name } : { name, slug })),
    updateWorkspace: (id: string, patch: { name?: string; slug?: string }) => unwrap(api.workspaces({ id }).patch(patch)),
    slugCheck: (query: { name?: string; slug?: string; except?: string }) => unwrap(api.workspaces.slug.get({ query })),
    logoUploadTarget: (workspaceId: string, contentType: "image/png" | "image/jpeg", size: number) =>
      unwrap(api.workspaces({ id: workspaceId }).logo.post({ contentType, size })),
    confirmLogo: (workspaceId: string, logoId: string) => unwrap(api.workspaces({ id: workspaceId }).logo({ logoId }).post()),
    removeLogo: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId }).logo.delete()),
    members: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId }).members.get()),
    setMemberRole: (workspaceId: string, userId: string, role: WorkspaceRole) =>
      unwrap(api.workspaces({ id: workspaceId }).members({ userId }).patch({ role })),
    removeMember: (workspaceId: string, userId: string) =>
      unwrap(api.workspaces({ id: workspaceId }).members({ userId }).delete()),
    invitations: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId }).invitations.get()),
    invite: (workspaceId: string, emails: string[]) => unwrap(api.workspaces({ id: workspaceId }).invitations.post({ emails })),
    revokeInvitation: (workspaceId: string, id: string) =>
      unwrap(api.workspaces({ id: workspaceId }).invitations({ invitationId: id }).delete()),
    resendInvitation: (workspaceId: string, id: string) =>
      unwrap(api.workspaces({ id: workspaceId }).invitations({ invitationId: id }).resend.post()),
    myInvitations: () => unwrap(api.me.invitations.get()),
    acceptMyInvitation: (id: string) => unwrap(api.me.invitations({ id }).accept.post()),
    invitation: (token: string) => unwrap(api.invitations({ token }).get()),
    acceptInvitation: (token: string) => unwrap(api.invitations({ token }).accept.post()),
    joinPreview: (value: string) => unwrap(api.join.preview.post({ value })),
    join: (value: string) => unwrap(api.join.post({ value })),
    sharedPreview: (code: string) => unwrap(api.join.shared({ code }).get()),
    domainWorkspaces: () => unwrap(api.join.domain.get()),
    joinByDomain: (workspaceId: string) => unwrap(api.join.domain({ workspaceId }).post()),
    cancelJoinRequest: (workspaceId: string) => unwrap(api.join.domain({ workspaceId }).request.delete()),
    workspaceAccess: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId }).access.get()),
    workspaceLimits: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId }).limits.get()),
    updateWorkspaceAccess: (
      workspaceId: string,
      patch: { shareLink?: "on" | "off" | "reset"; joinDomain?: string | null; joinMode?: "direct" | "approval" },
    ) => unwrap(api.workspaces({ id: workspaceId }).access.patch(patch)),
    joinRequests: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId })["join-requests"].get()),
    approveJoinRequest: (workspaceId: string, userId: string) =>
      unwrap(api.workspaces({ id: workspaceId })["join-requests"]({ userId }).approve.post()),
    declineJoinRequest: (workspaceId: string, userId: string) =>
      unwrap(api.workspaces({ id: workspaceId })["join-requests"]({ userId }).delete()),
    // Eden widens this public route's type with Response; the server only ever answers this object.
    authMethods: async (): Promise<AuthMethods> => (await unwrap(api["auth-methods"].get())) as AuthMethods,
    projects: (workspaceId: string) => unwrap(api.projects.get({ query: { workspaceId } })),
    createProject: (workspaceId: string, body: ProjectInput) => unwrap(api.projects.post({ workspaceId, ...body })),
    updateProject: (id: string, body: ProjectInput) => unwrap(api.projects({ id }).patch(body)),
    deleteProject: (id: string) => unwrap(api.projects({ id }).delete()),
    reports: (workspaceId: string, query: ReportsQuery) => unwrap(api.reports.get({ query: { workspaceId, ...query } })),
    reportCounts: (workspaceId: string, query: Omit<ReportsQuery, "page" | "perPage">) =>
      unwrap(api.reports.counts.get({ query: { workspaceId, ...query } })),
    report: (id: string) => unwrap(api.reports({ id }).get()),
    updateReport: (id: string, patch: ReportPatch) => unwrap(api.reports({ id }).patch(patch)),
    deleteReport: (id: string) => unwrap(api.reports({ id }).delete()),
    regenerateShare: (id: string) => unwrap(api.reports({ id }).share.regenerate.post()),
    share: (slug: string) => unwrap(api.share({ slug }).get()),
    comments: (reportId: string) => unwrap(api.reports({ id: reportId }).comments.get()),
    addComment: (reportId: string, body: string, replyTo?: string) =>
      unwrap(api.reports({ id: reportId }).comments.post(replyTo ? { body, replyTo } : { body })),
    editComment: (id: string, body: string) => unwrap(api.comments({ id }).patch({ body })),
    deleteComment: (id: string) => unwrap(api.comments({ id }).delete()),
    /** Adds the caller's emoji to a comment, or takes it off; returns the comment's reactions. */
    react: (commentId: string, emoji: string) => unwrap(api.comments({ id: commentId }).reactions.post({ emoji })),
    activity: (reportId: string) => unwrap(api.reports({ id: reportId }).activity.get()),
    updateName: (name: string) => unwrap(api.me.patch({ name })),
    avatarUploadTarget: (contentType: "image/png" | "image/jpeg", size: number) => unwrap(api.me.avatar.post({ contentType, size })),
    confirmAvatar: (avatarId: string) => unwrap(api.me.avatar({ avatarId }).post()),
    removeAvatar: () => unwrap(api.me.avatar.delete()),
    signInMethods: () => unwrap(api.me["sign-in-methods"].get()),
    clientConfig: async (): Promise<ClientConfig> => (await unwrap(api["client-config"].get())) as ClientConfig,
    notifications: () => unwrap(api.notifications.get()),
    readNotification: (id: string) => unwrap(api.notifications({ id }).read.post()),
    readAllNotifications: () => unwrap(api.notifications["read-all"].post()),
    mcpTokens: () => unwrap(api.me.tokens.get()),
    createMcpToken: (label: string) => unwrap(api.me.tokens.post({ label })),
    revokeMcpToken: (id: string) => unwrap(api.me.tokens({ id }).delete()),
    oauthApps: () => unwrap(api.me["oauth-apps"].get()),
    revokeOAuthApp: (clientId: string) => unwrap(api.me["oauth-apps"]({ clientId }).delete()),
    reportTrackers: (reportId: string) => unwrap(api.reports({ id: reportId }).trackers.get()),
    sendToTracker: (reportId: string, integrationId: string) =>
      unwrap(api.reports({ id: reportId }).trackers({ integrationId }).send.post()),
    connections: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId }).connections.get()),
    createConnection: (workspaceId: string, body: ConnectionInput) =>
      unwrap(api.workspaces({ id: workspaceId }).connections.post(body as never)),
    updateConnection: (workspaceId: string, id: string, body: ConnectionPatch) =>
      unwrap(api.workspaces({ id: workspaceId }).connections({ connectionId: id }).patch(body)),
    deleteConnection: (workspaceId: string, id: string) =>
      unwrap(api.workspaces({ id: workspaceId }).connections({ connectionId: id }).delete()),
    testConnection: (workspaceId: string, id: string) =>
      unwrap(api.workspaces({ id: workspaceId }).connections({ connectionId: id }).test.post()),
    connectionOptions: (workspaceId: string, id: string, list: OptionList, opts: { q?: string; parent?: string } = {}) =>
      unwrap(
        api
          .workspaces({ id: workspaceId })
          .connections({ connectionId: id })
          .options.get({ query: { list, ...(opts.q ? { q: opts.q } : {}), ...(opts.parent ? { parent: opts.parent } : {}) } }),
      ),
    integrations: (projectId: string) => unwrap(api.projects({ id: projectId }).integrations.get()),
    addIntegration: (projectId: string, body: IntegrationInput) =>
      unwrap(api.projects({ id: projectId }).integrations.post(body as never)),
    updateIntegration: (projectId: string, id: string, body: IntegrationPatch) =>
      unwrap(api.projects({ id: projectId }).integrations({ integrationId: id }).patch(body)),
    removeIntegration: (projectId: string, id: string) =>
      unwrap(api.projects({ id: projectId }).integrations({ integrationId: id }).delete()),
    testIntegration: (projectId: string, id: string) =>
      unwrap(api.projects({ id: projectId }).integrations({ integrationId: id }).test.post()),
  }
}

export type Api = ReturnType<typeof createApi>
export type Me = Awaited<ReturnType<Api["me"]>>
export type Project = Awaited<ReturnType<Api["projects"]>>[number]
export type Member = Awaited<ReturnType<Api["members"]>>[number]
export type Workspace = Awaited<ReturnType<Api["workspaces"]>>[number]
export type PendingInvitation = Awaited<ReturnType<Api["invitations"]>>[number]
export type MyInvitation = Awaited<ReturnType<Api["myInvitations"]>>[number]
export type JoinPreview = Awaited<ReturnType<Api["joinPreview"]>>
export type WorkspaceAccess = Awaited<ReturnType<Api["workspaceAccess"]>>
export type WorkspaceLimits = Awaited<ReturnType<Api["workspaceLimits"]>>
export type MyLimits = Awaited<ReturnType<Api["myLimits"]>>
export type JoinRequest = Awaited<ReturnType<Api["joinRequests"]>>[number]
export type InviteResult = Awaited<ReturnType<Api["invite"]>>[number]
export type InvitationInfo = Awaited<ReturnType<Api["invitation"]>>
export type ReportList = Awaited<ReturnType<Api["reports"]>>
export type ReportCounts = Awaited<ReturnType<Api["reportCounts"]>>
export type ReportListItem = ReportList["items"][number]
export type ReportDetail = Awaited<ReturnType<Api["report"]>>
/** A thread: its first comment, with the replies under it. */
export type CommentThread = Awaited<ReturnType<Api["comments"]>>[number]
/** One comment, a thread's first or a reply. */
export type Comment = CommentThread["replies"][number]
export type Reaction = Comment["reactions"][number]
export type Activity = Awaited<ReturnType<Api["activity"]>>[number]
export type Notifications = Awaited<ReturnType<Api["notifications"]>>
export type ReportTrackers = Awaited<ReturnType<Api["reportTrackers"]>>
export type TrackerLink = ReportTrackers["links"][number]
export type Integration = Awaited<ReturnType<Api["integrations"]>>[number]
/** A workspace connection; admins also get its settings and the projects that use it. */
export type Connection = Awaited<ReturnType<Api["connections"]>>[number] & {
  settings?: ConnectionSettings
  usedBy?: Array<{ projectId: string; projectName: string }>
}

const MESSAGES: Record<string, string> = {
  network: NETWORK_MESSAGE,
  unauthorized: "Sign in first",
  forbidden: "You don't have access to this",
  validation: "Some fields are invalid",
  rate_limited: "Too many requests. Try again in a moment.",
  internal: "Something went wrong on the server",
  slug_taken: "Another project already uses this slug",
  project_has_reports: "This project still has reports. Delete them first.",
  project_not_found: "Project not found",
  report_not_found: "Report not found",
  comment_not_found: "Comment not found",
  invalid_emoji: "Pick an emoji to react with",
  empty_comment: "A comment can't be empty",
  integration_not_found: "Integration not found",
  invalid_config: "The integration settings are invalid",
  invalid_base_url: "The ActiveCollab address must start with https://",
  send_in_progress: "This report is being sent. Wait a moment, then reload.",
  assignee_not_found: "That member doesn't exist",
  last_admin: "A workspace needs at least one admin",
  extension_mismatch: "This extension isn't the one registered on the server (EXTENSION_ID)",
  workspace_not_found: "Workspace not found",
  member_not_found: "Member not found",
  no_workspace: "Join or create a workspace first",
  internal_unavailable: "Internal sharing needs a company email address",
  email_unavailable: "Email is not set up on this server, so invitations cannot be sent",
  invite_email_mismatch: "This invitation is for a different email address",
  invite_unavailable: "This invite has expired or was withdrawn. Ask for a new one.",
  invitation_not_found: "Invitation not found",
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message
  if (error instanceof Error) return error.message
  return String(error)
}
