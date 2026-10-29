import { treaty } from "@elysiajs/eden"
import type { App } from "@bugberry/api"
import type {
  DemoRequestInput,
  Priority,
  ReportStatus,
  Visibility,
} from "@bugberry/shared"
import { unwrap } from "./query/unwrap"

export interface ReportPatch {
  title?: string
  status?: ReportStatus
  priority?: Priority
  visibility?: Visibility
  assigneeId?: string | null
  /** Null takes the report out of its project. */
  projectId?: string | null
}

export function createApi(origin: string = window.location.origin, fetcher: typeof fetch = fetch) {
  const { api } = treaty<App>(origin, { fetcher })
  return {
    report: (id: string) => unwrap(api.reports({ id }).get()),
    updateReport: (id: string, patch: ReportPatch) => unwrap(api.reports({ id }).patch(patch)),
    deleteReport: (id: string) => unwrap(api.reports({ id }).delete()),
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
    reportTrackers: (reportId: string) => unwrap(api.reports({ id: reportId }).trackers.get()),
    sendToTracker: (reportId: string, integrationId: string) =>
      unwrap(api.reports({ id: reportId }).trackers({ integrationId }).send.post()),
  }
}

export type Api = ReturnType<typeof createApi>
export type ReportDetail = Awaited<ReturnType<Api["report"]>>
/** A thread: its first comment, with the replies under it. */
export type CommentThread = Awaited<ReturnType<Api["comments"]>>[number]
/** One comment, a thread's first or a reply. */
export type Comment = CommentThread["replies"][number]
export type Reaction = Comment["reactions"][number]
export type Activity = Awaited<ReturnType<Api["activity"]>>[number]
export type ReportTrackers = Awaited<ReturnType<Api["reportTrackers"]>>
export type TrackerLink = ReportTrackers["links"][number]
