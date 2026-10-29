import { treaty } from "@elysiajs/eden"
import type { App } from "@bugberry/api"
import type {
  CaptureType,
  ConnectionSettings,
  DemoRequestInput,
  IntegrationProvider,
  OnboardingEvent,
  Priority,
  ReportStatus,
  UseTarget,
  Visibility,
  WorkspaceRole,
} from "@bugberry/shared"
import { unwrap } from "./query/unwrap"


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

export interface AiProviderInput {
  preset: "openai" | "custom"
  baseUrl?: string
  model: string
  /** Left out to keep the saved key. */
  apiKey?: string
}

export interface AiTemplateInput {
  name: string
  /** The description's sections, as Markdown headings. */
  skeleton: string
  instructions: string
}

export interface AiSettingsPatch {
  sendResponseBodies?: boolean
  defaultTemplateId?: string | null
  projectDefaults?: Array<{ projectId: string; templateId: string | null }>
}

export function createApi(origin: string = window.location.origin, fetcher: typeof fetch = fetch) {
  const { api } = treaty<App>(origin, { fetcher })
  return {
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
    invite: (workspaceId: string, emails: string[], role?: "member" | "admin") =>
      unwrap(api.workspaces({ id: workspaceId }).invitations.post(role ? { emails, role } : { emails })),
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
    projects: (workspaceId: string) => unwrap(api.projects.get({ query: { workspaceId } })),
    createProject: (workspaceId: string, body: ProjectInput) => unwrap(api.projects.post({ workspaceId, ...body })),
    updateProject: (id: string, body: ProjectInput) => unwrap(api.projects({ id }).patch(body)),
    deleteProject: (id: string) => unwrap(api.projects({ id }).delete()),
    projectLogoUploadTarget: (projectId: string, contentType: "image/png" | "image/jpeg", size: number) =>
      unwrap(api.projects({ id: projectId }).logo.post({ contentType, size })),
    confirmProjectLogo: (projectId: string, logoId: string) => unwrap(api.projects({ id: projectId }).logo({ logoId }).post()),
    removeProjectLogo: (projectId: string) => unwrap(api.projects({ id: projectId }).logo.delete()),
    projectsOverview: (workspaceId: string) => unwrap(api.projects.overview.get({ query: { workspaceId } })),
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
    /** "Book your demo" on the public site. */
    requestDemo: (input: DemoRequestInput) => unwrap(api["demo-requests"].post(input)),
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
    /** Write with AI: the team key (details for admins only), the switch, the defaults and the shared templates. */
    aiSetup: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId }).ai.get()),
    saveAiProvider: (workspaceId: string, body: AiProviderInput) => unwrap(api.workspaces({ id: workspaceId }).ai.provider.put(body)),
    removeAiProvider: (workspaceId: string) => unwrap(api.workspaces({ id: workspaceId }).ai.provider.delete()),
    updateAiSettings: (workspaceId: string, patch: AiSettingsPatch) => unwrap(api.workspaces({ id: workspaceId }).ai.settings.patch(patch)),
    createAiTemplate: (workspaceId: string, body: AiTemplateInput) => unwrap(api.workspaces({ id: workspaceId }).ai.templates.post(body)),
    updateAiTemplate: (workspaceId: string, id: string, body: Partial<AiTemplateInput>) =>
      unwrap(api.workspaces({ id: workspaceId }).ai.templates({ templateId: id }).patch(body)),
    deleteAiTemplate: (workspaceId: string, id: string) => unwrap(api.workspaces({ id: workspaceId }).ai.templates({ templateId: id }).delete()),
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
export type Project = Awaited<ReturnType<Api["projects"]>>[number]
export type Member = Awaited<ReturnType<Api["members"]>>[number]
export type Workspace = Awaited<ReturnType<Api["workspaces"]>>[number]
export type PendingInvitation = Awaited<ReturnType<Api["invitations"]>>[number]
export type MyInvitation = Awaited<ReturnType<Api["myInvitations"]>>[number]
export type JoinPreview = Awaited<ReturnType<Api["joinPreview"]>>
export type WorkspaceAccess = Awaited<ReturnType<Api["workspaceAccess"]>>
export type WorkspaceLimits = Awaited<ReturnType<Api["workspaceLimits"]>>
export type AiSetup = Awaited<ReturnType<Api["aiSetup"]>>
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
export type ReportTrackers = Awaited<ReturnType<Api["reportTrackers"]>>
export type TrackerLink = ReportTrackers["links"][number]
export type Integration = Awaited<ReturnType<Api["integrations"]>>[number]
/** A workspace connection; admins also get its settings and the projects that use it. */
export type Connection = Awaited<ReturnType<Api["connections"]>>[number] & {
  settings?: ConnectionSettings
  usedBy?: Array<{ projectId: string; projectName: string }>
}
