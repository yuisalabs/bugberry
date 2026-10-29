import { and, asc, count, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { AppDeps } from "../../deps"
import type { CurrentUser } from "../../plugins/auth"
import { memberRole, requireReportMember } from "../../workspaces/access"
import { comment, commentReaction, notification, report, user } from "../../db/schema"
import { badRequest, forbidden, notFound, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { mentionEmail } from "../../email/mention-email"
import { createEmailSender, type EmailSender } from "../../email/sender"
import { memberNames, mentionedIds, mentionsOf, notifyMentions, snippetOf } from "./mentions"
import { isEmoji, reactionsFor } from "./reactions"
import { notifyReplies } from "./replies"

const author = alias(user, "author")
const commentColumns = {
  id: comment.id,
  reportId: comment.reportId,
  parentId: comment.parentId,
  body: comment.body,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
  deletedAt: comment.deletedAt,
  viaAgent: comment.viaAgent,
  author: { id: author.id, name: author.name, image: author.image },
}

/** A comment counts as edited when it changed more than a second after it was written. */
const EDITED_AFTER_MS = 1000

export type { ReactionView } from "./reactions"

function cleanBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) throw badRequest("empty_comment", "Comment is empty")
  return trimmed
}

/** Comments on reports, with mentions, notifications and mention emails; REST and MCP both use it. */
export function createCommentsService(deps: AppDeps) {
  const { db, config } = deps
  const sender: EmailSender | null = deps.email ?? (config.email ? createEmailSender(config.email) : null)

  const select = () => db.select(commentColumns).from(comment).innerJoin(author, eq(comment.authorId, author.id))
  type CommentRow = Awaited<ReturnType<ReturnType<typeof select>["where"]>>[number]
  /**
   * What the API shows of each comment, with the current names of the members it mentions. A deleted comment
   * kept for its replies shows nothing of what it said or who said it.
   */
  const toViews = async (rows: CommentRow[], workspaceId: string) => {
    const live = rows.filter((row) => row.deletedAt === null)
    const names = await memberNames(db, workspaceId, [...new Set(live.flatMap((row) => mentionedIds(row.body)))])
    const reactions = await reactionsFor(db, live.map((row) => row.id))
    return rows.map((row) => {
      const deleted = row.deletedAt !== null
      return {
        id: row.id,
        reportId: row.reportId,
        parentId: row.parentId,
        author: deleted ? null : row.author,
        body: deleted ? "" : row.body,
        viaAgent: deleted ? null : row.viaAgent,
        createdAt: row.createdAt,
        edited: !deleted && row.updatedAt.getTime() - row.createdAt.getTime() > EDITED_AFTER_MS,
        deleted,
        mentions: deleted ? [] : mentionsOf(row.body, names),
        reactions: deleted ? [] : (reactions.get(row.id) ?? []),
      }
    })
  }
  const loadComment = async (id: string, workspaceId: string) => {
    const [row] = await select().where(eq(comment.id, id)).limit(1)
    if (!row) throw notFound("comment_not_found", "Comment not found")
    const [shown] = await toViews([row], workspaceId)
    return shown as NonNullable<typeof shown>
  }
  /**
   * Emails the people just notified, in the background: the comment is already saved, and a failed
   * email is only logged, never retried.
   */
  const emailMentions = (input: {
    userIds: string[]
    commentId: string
    reportId: string
    workspaceId: string
    actorName: string
    body: string
    viaAgent: string | null
  }) => {
    if (!sender || input.userIds.length === 0) return
    const mailer = sender
    const task = (async () => {
      const [target] = await db.select({ number: report.number, title: report.title }).from(report).where(eq(report.id, input.reportId)).limit(1)
      if (!target) return
      const names = await memberNames(db, input.workspaceId, mentionedIds(input.body))
      const email = mentionEmail({
        actorName: input.actorName,
        reportNumber: target.number,
        reportTitle: target.title,
        snippet: snippetOf(input.body, names),
        url: `${config.appUrl}/app/r/${input.reportId}#comment-${input.commentId}`,
        viaAgent: input.viaAgent,
      })
      const people = await db.select({ email: user.email }).from(user).where(inArray(user.id, input.userIds))
      for (const person of people) {
        await mailer.send({ to: person.email, ...email }).catch((error) => console.error("mention email failed", error))
      }
    })().catch((error) => console.error("mention email failed", error))
    deps.background?.(task)
  }
  /** A ready report in a workspace the caller belongs to; returns that workspace. */
  const requireReport = async (userId: string, id: string) => {
    const { workspaceId } = await requireReportMember(db, userId, id)
    const [row] = await db
      .select({ id: report.id })
      .from(report)
      .where(and(eq(report.id, id), eq(report.uploadStatus, "ready")))
      .limit(1)
    if (!row) throw notFound("report_not_found", "Report not found")
    return workspaceId
  }
  /** The comment's author and the caller's role in its report's workspace; outsiders get 404. */
  const commentAccess = async (userId: string, id: string) => {
    const [row] = await db
      .select({
        authorId: comment.authorId,
        reportId: comment.reportId,
        workspaceId: report.workspaceId,
        viaAgent: comment.viaAgent,
        parentId: comment.parentId,
        deletedAt: comment.deletedAt,
      })
      .from(comment)
      .innerJoin(report, eq(report.id, comment.reportId))
      .where(eq(comment.id, id))
      .limit(1)
    const role = row ? await memberRole(db, userId, row.workspaceId) : null
    if (!row || !role || row.deletedAt !== null) throw notFound("comment_not_found", "Comment not found")
    return { ...row, role }
  }
  /** The thread a reply goes into: the comment's own thread when it is itself a reply, so threads stay one level. */
  const threadRootOf = async (reportId: string, replyTo: string) => {
    const [target] = await db
      .select({ id: comment.id, parentId: comment.parentId })
      .from(comment)
      .where(and(eq(comment.id, replyTo), eq(comment.reportId, reportId)))
      .limit(1)
    if (!target) throw notFound("comment_not_found", "Comment not found")
    return target.parentId ?? target.id
  }

  return {
    /** Threads newest first by their first comment; each thread's replies oldest first. */
    async list(current: CurrentUser, reportId: string) {
      const workspaceId = await requireReport(current.id, reportId)
      const rows = await select().where(eq(comment.reportId, reportId)).orderBy(asc(comment.createdAt), asc(comment.id))
      const views = await toViews(rows, workspaceId)
      const replies = new Map<string, typeof views>()
      for (const view of views) {
        if (view.parentId) replies.set(view.parentId, [...(replies.get(view.parentId) ?? []), view])
      }
      return views
        .filter((view) => view.parentId === null)
        .reverse()
        .map((root) => ({ ...root, replies: replies.get(root.id) ?? [] }))
    },
    /** `viaAgent` is set only by MCP tools; REST never passes it. `replyTo` files the comment in that one's thread. */
    async create(current: CurrentUser, reportId: string, body: string, opts: { viaAgent?: string; replyTo?: string } = {}) {
      const workspaceId = await requireReport(current.id, reportId)
      const id = newId()
      const text = cleanBody(body)
      const viaAgent = opts.viaAgent ?? null
      const parentId = opts.replyTo ? await threadRootOf(reportId, opts.replyTo) : null
      await db.insert(comment).values({ id, reportId, authorId: current.id, body: text, viaAgent, parentId })
      const notified = await notifyMentions(db, { commentId: id, reportId, workspaceId, actorId: current.id, body: text })
      if (parentId) await notifyReplies(db, { commentId: id, reportId, workspaceId, actorId: current.id, rootId: parentId })
      emailMentions({ userIds: notified, commentId: id, reportId, workspaceId, actorName: current.name, body: text, viaAgent })
      return loadComment(id, workspaceId)
    },
    async edit(current: CurrentUser, commentId: string, body: string) {
      const access = await commentAccess(current.id, commentId)
      if (access.authorId !== current.id) throw forbidden("Only the author can edit this comment")
      const text = cleanBody(body)
      await db.update(comment).set({ body: text }).where(eq(comment.id, commentId))
      const notified = await notifyMentions(db, {
        commentId,
        reportId: access.reportId,
        workspaceId: access.workspaceId,
        actorId: current.id,
        body: text,
      })
      emailMentions({
        userIds: notified,
        commentId,
        reportId: access.reportId,
        workspaceId: access.workspaceId,
        actorName: current.name,
        body: text,
        viaAgent: access.viaAgent,
      })
      return loadComment(commentId, access.workspaceId)
    },
    /** Adds the caller's emoji to a comment, or takes it off when it is already there; returns its reactions. */
    async toggleReaction(current: CurrentUser, commentId: string, emoji: string) {
      await commentAccess(current.id, commentId)
      if (!isEmoji(emoji)) throw unprocessable("invalid_emoji", "A reaction must be an emoji")
      const mine = and(eq(commentReaction.commentId, commentId), eq(commentReaction.userId, current.id), eq(commentReaction.emoji, emoji))
      const removed = await db.delete(commentReaction).where(mine).returning({ emoji: commentReaction.emoji })
      if (removed.length === 0) {
        await db.insert(commentReaction).values({ commentId, userId: current.id, emoji }).onConflictDoNothing()
      }
      return (await reactionsFor(db, [commentId])).get(commentId) ?? []
    },
    /**
     * A thread's first comment with replies stays as "This comment was deleted": its body is wiped (search reads
     * it) and its reactions and notifications go. Anything else is removed, and a deleted first comment left with
     * no replies goes with its last one.
     */
    async remove(current: CurrentUser, commentId: string) {
      const { authorId, role, parentId } = await commentAccess(current.id, commentId)
      if (authorId !== current.id && role !== "admin") {
        throw forbidden("Only the author or an admin can delete this comment")
      }
      const [{ replies } = { replies: 0 }] =
        parentId === null ? await db.select({ replies: count() }).from(comment).where(eq(comment.parentId, commentId)) : []
      if (replies > 0) {
        await db.transaction(async (tx) => {
          await tx.update(comment).set({ body: "", deletedAt: new Date() }).where(eq(comment.id, commentId))
          await tx.delete(commentReaction).where(eq(commentReaction.commentId, commentId))
          await tx.delete(notification).where(eq(notification.commentId, commentId))
        })
        return { ok: true as const }
      }
      await db.delete(comment).where(eq(comment.id, commentId))
      if (parentId !== null) {
        const [root] = await db.select({ deletedAt: comment.deletedAt }).from(comment).where(eq(comment.id, parentId)).limit(1)
        const [left] = await db.select({ value: count() }).from(comment).where(eq(comment.parentId, parentId))
        if (root?.deletedAt && (left?.value ?? 0) === 0) await db.delete(comment).where(eq(comment.id, parentId))
      }
      return { ok: true as const }
    },
  }
}

export type CommentsService = ReturnType<typeof createCommentsService>
export type CommentView = Awaited<ReturnType<CommentsService["list"]>>[number]
