import { treaty } from "@elysiajs/eden"
import type { App } from "@bugberry/api"
import type { Settings } from "./settings"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }

  /** Network failures, rate limits, server errors and not-yet-visible uploads may succeed on a later try. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500 || this.code === "upload_incomplete"
  }
}

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

interface EdenResult<T> {
  data: T | null
  error: { status: unknown; value: unknown } | null
}

async function call<T>(request: () => Promise<EdenResult<T>>): Promise<NonNullable<T>> {
  let result: EdenResult<T>
  try {
    result = await request()
  } catch {
    throw new ApiError(0, "network", "Can't reach the BugBerry server")
  }
  if (result.error) {
    // Eden reports a failed fetch as status 503 carrying the thrown Error, not a server response.
    if (result.error.value instanceof Error) throw new ApiError(0, "network", "Can't reach the BugBerry server")
    const body = (result.error.value ?? {}) as { code?: unknown; message?: unknown }
    const code = typeof body.code === "string" ? body.code : "error"
    throw new ApiError(
      Number(result.error.status) || 0,
      code,
      MESSAGES[code] ?? (typeof body.message === "string" ? body.message : "The request to the server failed"),
    )
  }
  if (result.data === null || result.data === undefined) throw new ApiError(0, "empty", "The server sent an empty response")
  return result.data as NonNullable<T>
}

export function createBugberryApi(settings: Settings, fetcher: typeof fetch = fetch) {
  // The dashboard's sign-in cookie: host_permissions let extension pages and the service worker send it.
  const client = treaty<App>(settings.serverUrl, { fetch: { credentials: "include" }, fetcher })
  type UploadBody = Parameters<typeof client.api.reports.uploads.post>[0]
  type UpdateBody = Parameters<ReturnType<typeof client.api.reports>["patch"]>[0]

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
  }
}

export type BugberryApi = ReturnType<typeof createBugberryApi>
export type Project = Awaited<ReturnType<BugberryApi["listProjects"]>>[number]
export type Workspace = Awaited<ReturnType<BugberryApi["listWorkspaces"]>>[number]
export type Member = Awaited<ReturnType<BugberryApi["listMembers"]>>[number]
export type ReportTrackers = Awaited<ReturnType<BugberryApi["reportTrackers"]>>
export type CreateUploadBody = Parameters<BugberryApi["createUpload"]>[0]
export type UploadSession = Awaited<ReturnType<BugberryApi["createUpload"]>>
