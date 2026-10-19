import { and, asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
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
  author: { id: author.id, name: author.name, image: author.image },
}
const commentBody = t.Object({ body: t.String({ minLength: 1, maxLength: 5000 }) })

function cleanBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) throw badRequest("empty_comment", "Comment is empty")
  return trimmed
}

export function commentsModule(deps: AppDeps) {
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
  const emailMentions = (input: { userIds: string[]; commentId: string; reportId: string; workspaceId: string; actorName: string; body: string }) => {
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
      .select({ authorId: comment.authorId, reportId: comment.reportId, workspaceId: report.workspaceId })
      .from(comment)
      .innerJoin(report, eq(report.id, comment.reportId))
      .where(eq(comment.id, id))
      .limit(1)
    const role = row ? await memberRole(db, userId, row.workspaceId) : null
    if (!row || !role) throw notFound("comment_not_found", "Comment not found")
    return { ...row, role }
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/reports/:id/comments",
      async ({ user: current, params }) => {
        const workspaceId = await requireReport(current.id, params.id)
        const rows = await select().where(eq(comment.reportId, params.id)).orderBy(asc(comment.createdAt), asc(comment.id))
        return withMentions(rows, workspaceId)
      },
      { auth: true },
    )
    .post(
      "/reports/:id/comments",
      async ({ user: current, params, body }) => {
        const workspaceId = await requireReport(current.id, params.id)
        const id = newId()
        const text = cleanBody(body.body)
        await db.insert(comment).values({ id, reportId: params.id, authorId: current.id, body: text })
        const notified = await notifyMentions(db, { commentId: id, reportId: params.id, workspaceId, actorId: current.id, body: text })
        emailMentions({ userIds: notified, commentId: id, reportId: params.id, workspaceId, actorName: current.name, body: text })
        return loadComment(id, workspaceId)
      },
      { auth: true, body: commentBody },
    )
    .patch(
      "/comments/:id",
      async ({ user: current, params, body }) => {
        const access = await commentAccess(current.id, params.id)
        if (access.authorId !== current.id) throw forbidden("Only the author can edit this comment")
        const text = cleanBody(body.body)
        await db.update(comment).set({ body: text }).where(eq(comment.id, params.id))
        const notified = await notifyMentions(db, {
          commentId: params.id,
          reportId: access.reportId,
          workspaceId: access.workspaceId,
          actorId: current.id,
          body: text,
        })
        emailMentions({
          userIds: notified,
          commentId: params.id,
          reportId: access.reportId,
          workspaceId: access.workspaceId,
          actorName: current.name,
          body: text,
        })
        return loadComment(params.id, access.workspaceId)
      },
      { auth: true, body: commentBody },
    )
    .delete(
      "/comments/:id",
      async ({ user: current, params }) => {
        const { authorId, role } = await commentAccess(current.id, params.id)
        if (authorId !== current.id && role !== "admin") {
          throw forbidden("Only the author or an admin can delete this comment")
        }
        await db.delete(comment).where(eq(comment.id, params.id))
        return { ok: true }
      },
      { auth: true },
    )
}
