import { treaty } from "@elysiajs/eden"
import type { App } from "@bugberry/api"
import type { DemoRequestInput } from "@bugberry/shared"
import { unwrap } from "./query/unwrap"

export function createApi(origin: string = window.location.origin, fetcher: typeof fetch = fetch) {
  const { api } = treaty<App>(origin, { fetcher })
  return {
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
  }
}

export type Api = ReturnType<typeof createApi>
/** A thread: its first comment, with the replies under it. */
export type CommentThread = Awaited<ReturnType<Api["comments"]>>[number]
/** One comment, a thread's first or a reply. */
export type Comment = CommentThread["replies"][number]
export type Reaction = Comment["reactions"][number]
export type Activity = Awaited<ReturnType<Api["activity"]>>[number]
