import { and, asc, count, eq, inArray, ne, or } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { type Db, executor, withTransaction } from "../../db/client"
import { comment, commentReaction, notification, report, user, workspaceMember } from "../../db/schema"
import { newId } from "../../lib/ids"

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
const selectComments = (db: Db) =>
  executor(db).select(commentColumns).from(comment).innerJoin(author, eq(comment.authorId, author.id))

export type CommentRow = Awaited<ReturnType<typeof listReportComments>>[number]

export async function findComment(db: Db, id: string) {
  const [row] = await selectComments(db).where(eq(comment.id, id)).limit(1)
  return row ?? null
}

/** Oldest first. */
export function listReportComments(db: Db, reportId: string) {
  return selectComments(db).where(eq(comment.reportId, reportId)).orderBy(asc(comment.createdAt), asc(comment.id))
}

/** The comment with its report's workspace, or null. */
export async function findCommentPlace(db: Db, id: string) {
  const [row] = await executor(db)
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
  return row ?? null
}

/** A comment of this report, with the thread it is in. */
export async function findReportComment(db: Db, reportId: string, id: string) {
  const [row] = await executor(db)
    .select({ id: comment.id, parentId: comment.parentId })
    .from(comment)
    .where(and(eq(comment.id, id), eq(comment.reportId, reportId)))
    .limit(1)
  return row ?? null
}

export async function isReadyReport(db: Db, reportId: string): Promise<boolean> {
  const [row] = await executor(db)
    .select({ id: report.id })
    .from(report)
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
    .limit(1)
  return row !== undefined
}

export async function findReportHeading(db: Db, reportId: string) {
  const [row] = await executor(db)
    .select({ number: report.number, title: report.title })
    .from(report)
    .where(eq(report.id, reportId))
    .limit(1)
  return row ?? null
}

export function userEmails(db: Db, userIds: string[]) {
  return executor(db).select({ email: user.email }).from(user).where(inArray(user.id, userIds))
}

export async function insertComment(
  db: Db,
  values: { id: string; reportId: string; authorId: string; body: string; viaAgent: string | null; parentId: string | null },
): Promise<void> {
  await executor(db).insert(comment).values(values)
}

export async function updateCommentBody(db: Db, id: string, body: string): Promise<void> {
  await executor(db).update(comment).set({ body }).where(eq(comment.id, id))
}

export async function countReplies(db: Db, parentId: string): Promise<number> {
  const [row] = await executor(db).select({ value: count() }).from(comment).where(eq(comment.parentId, parentId))
  return row?.value ?? 0
}

/** Keeps the comment as a placeholder for its replies: body wiped, reactions and notifications gone. */
export function wipeComment(db: Db, id: string): Promise<void> {
  return withTransaction(db, async () => {
    const x = executor(db)
    await x.update(comment).set({ body: "", deletedAt: new Date() }).where(eq(comment.id, id))
    await x.delete(commentReaction).where(eq(commentReaction.commentId, id))
    await x.delete(notification).where(eq(notification.commentId, id))
  })
}

export async function deleteComment(db: Db, id: string): Promise<void> {
  await executor(db).delete(comment).where(eq(comment.id, id))
}

export async function findCommentDeletedAt(db: Db, id: string) {
  const [row] = await executor(db).select({ deletedAt: comment.deletedAt }).from(comment).where(eq(comment.id, id)).limit(1)
  return row ?? null
}

/** True when the person had that emoji on the comment. */
export async function deleteReaction(db: Db, commentId: string, userId: string, emoji: string): Promise<boolean> {
  const removed = await executor(db)
    .delete(commentReaction)
    .where(and(eq(commentReaction.commentId, commentId), eq(commentReaction.userId, userId), eq(commentReaction.emoji, emoji)))
    .returning({ emoji: commentReaction.emoji })
  return removed.length > 0
}

export async function insertReaction(db: Db, commentId: string, userId: string, emoji: string): Promise<void> {
  await executor(db).insert(commentReaction).values({ commentId, userId, emoji }).onConflictDoNothing()
}

/** The comments' reactions with who made them, oldest first. */
export function listReactions(db: Db, commentIds: string[]) {
  return executor(db)
    .select({ commentId: commentReaction.commentId, emoji: commentReaction.emoji, id: user.id, name: user.name })
    .from(commentReaction)
    .innerJoin(user, eq(user.id, commentReaction.userId))
    .where(inArray(commentReaction.commentId, commentIds))
    .orderBy(asc(commentReaction.createdAt), asc(commentReaction.userId))
}

/** These people's names, for those who are members of the workspace. */
export function membersAmong(db: Db, workspaceId: string, userIds: string[]) {
  return executor(db)
    .select({ id: user.id, name: user.name })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(workspaceMember.workspaceId, workspaceId), inArray(workspaceMember.userId, userIds)))
}

/** Everyone else's comments in the thread: its first comment and its replies. */
export function listThreadAuthors(db: Db, rootId: string, exceptCommentId: string) {
  return executor(db)
    .select({ authorId: comment.authorId, parentId: comment.parentId })
    .from(comment)
    .where(and(or(eq(comment.id, rootId), eq(comment.parentId, rootId)), ne(comment.id, exceptCommentId)))
}

interface NotificationTarget {
  commentId: string
  reportId: string
  actorId: string
}

/**
 * Mention notifications for these people; someone who only had a reply notification for this comment gets the
 * mention instead (and its email). Returns who was notified just now.
 */
export async function insertMentionNotifications(db: Db, target: NotificationTarget, userIds: string[]): Promise<string[]> {
  const rows = await executor(db)
    .insert(notification)
    .values(userIds.map((userId) => ({ id: newId(), userId, ...target })))
    .onConflictDoUpdate({
      target: [notification.userId, notification.commentId],
      set: { kind: "mention", readAt: null },
      setWhere: ne(notification.kind, "mention"),
    })
    .returning({ userId: notification.userId })
  return rows.map((row) => row.userId)
}

/** Reply notifications; anyone already notified about this comment keeps what they had. */
export async function insertReplyNotifications(
  db: Db,
  target: NotificationTarget,
  people: Array<{ userId: string; kind: "reply_to_you" | "reply_in_thread" }>,
): Promise<void> {
  await executor(db)
    .insert(notification)
    .values(people.map(({ userId, kind }) => ({ id: newId(), userId, ...target, kind })))
    .onConflictDoNothing({ target: [notification.userId, notification.commentId] })
}

export function workspaceMembersAmong(db: Db, workspaceId: string, userIds: string[]) {
  return executor(db)
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), inArray(workspaceMember.userId, userIds)))
}
