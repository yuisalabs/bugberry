import { treaty } from "@elysiajs/eden"
import type { App } from "@bugberry/api"
import { type EdenResult, unwrapWith } from "@bugberry/shared"
import type { Settings } from "./settings"

export { ApiError } from "@bugberry/shared"

/** The extension's text for the server codes the extension can run into; other codes keep the server's message. */
const MESSAGES: Record<string, string> = {
  unauthorized: "Your session ended. Sign in, then send again.",
  forbidden: "This account doesn't have access to do that.",
  validation: "The report isn't valid. Check the title and project.",
  rate_limited: "Too many reports in a short time. Try again in a moment.",
  internal: "Something went wrong on the BugBerry server.",
  maintenance: "BugBerry is down for maintenance. Send the report again later.",
  project_not_found: "Project not found. Pick another project.",
  report_not_found: "Report not found on the server.",
  file_too_large: "The file is too large for this server.",
  upload_incomplete: "The server hasn't finished receiving the upload.",
  upload_size_mismatch: "The file the server received doesn't match its size. The report will be uploaded again.",
  duration_required: "Couldn't read the video's duration.",
}

const TEXT = { network: "Can't reach the BugBerry server", fallback: "The request to the server failed", messages: MESSAGES }

function call<T>(request: () => Promise<EdenResult<T>>): Promise<NonNullable<T>> {
  // Called inside the try of unwrapWith's await, so a request that throws at once is a network error too.
  return unwrapWith(TEXT, Promise.resolve().then(request))
}

export function createBugberryApi(settings: Settings, fetcher: typeof fetch = fetch) {
  // The dashboard's sign-in cookie: host_permissions let extension pages and the service worker send it.
  const client = treaty<App>(settings.serverUrl, { fetch: { credentials: "include" }, fetcher })
  type UploadBody = Parameters<typeof client.api.reports.uploads.post>[0]
  type UpdateBody = Parameters<ReturnType<typeof client.api.reports>["patch"]>[0]
  type AiWriteBody = Parameters<ReturnType<typeof client.api.workspaces>["ai"]["write"]["post"]>[0]

  return {
    me: () => call(() => client.api.me.get()),
    /** Public; older servers leave out `maxUploadMb`. */
    clientConfig: () => call(() => client.api["client-config"].get()),
    listWorkspaces: () => call(() => client.api.workspaces.get()),
    listProjects: (workspaceId: string) => call(() => client.api.projects.get({ query: { workspaceId } })),
    /** Older servers have no such endpoint and answer 404: see limitsFor. */
    workspaceLimits: (workspaceId: string) => call(() => client.api.workspaces({ id: workspaceId }).limits.get()),
    /** Makes it the workspace the dashboard opens, so its report list is the one shown. */
    setCurrentWorkspace: (workspaceId: string) => call(() => client.api.me.workspace.put({ workspaceId })),
    createUpload: (body: UploadBody) => call(() => client.api.reports.uploads.post(body)),
    finalize: (reportId: string) => call(() => client.api.reports({ id: reportId }).finalize.post()),
    /** New links for the parts of an upload in progress, once the first ones expired. Older servers never send parts. */
    mediaParts: (reportId: string) => call(() => client.api.reports({ id: reportId }).parts.post()),
    /** Older servers have no such endpoint and answer 404; callers ignore that. */
    setLocation: (reportId: string, coordinates: { latitude: number; longitude: number }) =>
      call(() => client.api.reports({ id: reportId }).location.post(coordinates)),
    /** The people a report can be assigned to. */
    listMembers: (workspaceId: string) => call(() => client.api.workspaces({ id: workspaceId }).members.get()),
    getReport: (reportId: string) => call(() => client.api.reports({ id: reportId }).get()),
    updateReport: (reportId: string, body: UpdateBody) => call(() => client.api.reports({ id: reportId }).patch(body)),
    /** The project's trackers a sent report can go to, and where it already went. */
    reportTrackers: (reportId: string) => call(() => client.api.reports({ id: reportId }).trackers.get()),
    sendToTracker: (reportId: string, integrationId: string) =>
      call(() => client.api.reports({ id: reportId }).trackers({ integrationId }).send.post()),
    /** Write with AI: whether the workspace has a team key, its templates and defaults. Older servers answer 404. */
    aiSetup: (workspaceId: string) => call(() => client.api.workspaces({ id: workspaceId }).ai.get()),
    /** A title and description drafted with the workspace's team key. */
    aiWrite: (workspaceId: string, body: AiWriteBody) => call(() => client.api.workspaces({ id: workspaceId }).ai.write.post(body)),
  }
}

export type BugberryApi = ReturnType<typeof createBugberryApi>
export type Project = Awaited<ReturnType<BugberryApi["listProjects"]>>[number]
export type Workspace = Awaited<ReturnType<BugberryApi["listWorkspaces"]>>[number]
export type Member = Awaited<ReturnType<BugberryApi["listMembers"]>>[number]
export type ReportTrackers = Awaited<ReturnType<BugberryApi["reportTrackers"]>>
export type AiSetup = Awaited<ReturnType<BugberryApi["aiSetup"]>>
export type CreateUploadBody = Parameters<BugberryApi["createUpload"]>[0]
export type UploadSession = Awaited<ReturnType<BugberryApi["createUpload"]>>
