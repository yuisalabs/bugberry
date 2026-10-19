import { and, asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { AppDeps } from "../../app"
import type { CurrentUser } from "../../auth/plugin"
import { memberRole, requireReportMember } from "../../workspaces/access"
import { comment, report, user } from "../../db/schema"
import { badRequest, forbidden, notFound } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { mentionEmail } from "../../email/mention-email"
import { createEmailSender, type EmailSender } from "../../email/sender"
import { memberNames, mentionedIds, mentionsOf, notifyMentions, snippetOf } from "./mentions"

const author = alias(user, "author")
const commentColumns = {
  id: comment.id,
  body: comment.body,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
  viaAgent: comment.viaAgent,
  author: { id: author.id, name: author.name, image: author.image },
}

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
  /** Adds the current names of the workspace members each comment mentions. */
  const withMentions = async (rows: CommentRow[], workspaceId: string) => {
    const names = await memberNames(db, workspaceId, [...new Set(rows.flatMap((row) => mentionedIds(row.body)))])
    return rows.map((row) => ({ ...row, mentions: mentionsOf(row.body, names) }))
  }
  const loadComment = async (id: string, workspaceId: string) => {
    const [row] = await select().where(eq(comment.id, id)).limit(1)
    if (!row) throw notFound("comment_not_found", "Comment not found")
    const [shown] = await withMentions([row], workspaceId)
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
      .select({ authorId: comment.authorId, reportId: comment.reportId, workspaceId: report.workspaceId, viaAgent: comment.viaAgent })
      .from(comment)
      .innerJoin(report, eq(report.id, comment.reportId))
      .where(eq(comment.id, id))
      .limit(1)
    const role = row ? await memberRole(db, userId, row.workspaceId) : null
    if (!row || !role) throw notFound("comment_not_found", "Comment not found")
    return { ...row, role }
  }

  return {
    async list(current: CurrentUser, reportId: string) {
      const workspaceId = await requireReport(current.id, reportId)
      const rows = await select().where(eq(comment.reportId, reportId)).orderBy(asc(comment.createdAt), asc(comment.id))
      return withMentions(rows, workspaceId)
    },
    /** `viaAgent` is set only by MCP tools; REST never passes it. */
    async create(current: CurrentUser, reportId: string, body: string, opts: { viaAgent?: string } = {}) {
      const workspaceId = await requireReport(current.id, reportId)
      const id = newId()
      const text = cleanBody(body)
      const viaAgent = opts.viaAgent ?? null
      await db.insert(comment).values({ id, reportId, authorId: current.id, body: text, viaAgent })
      const notified = await notifyMentions(db, { commentId: id, reportId, workspaceId, actorId: current.id, body: text })
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
    async remove(current: CurrentUser, commentId: string) {
      const { authorId, role } = await commentAccess(current.id, commentId)
      if (authorId !== current.id && role !== "admin") {
        throw forbidden("Only the author or an admin can delete this comment")
      }
      await db.delete(comment).where(eq(comment.id, commentId))
      return { ok: true as const }
    },
  }
}

export type CommentsService = ReturnType<typeof createCommentsService>
export type CommentView = Awaited<ReturnType<CommentsService["list"]>>[number]
