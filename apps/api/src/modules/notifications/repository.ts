import { and, count, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { type Db, executor } from "../../db/client"
import { comment, notification, project, projectGuest, report, user, workspaceMember } from "../../db/schema"

const actor = alias(user, "actor")
const note = alias(comment, "note")

/** Rows of the caller's on a report they can still read: as a member of its workspace, or a guest of its project. */
const visible = (userId: string) =>
  and(
    eq(notification.userId, userId),
    or(
      exists(
        sql`(SELECT 1 FROM ${workspaceMember} WHERE ${workspaceMember.userId} = ${userId} AND ${workspaceMember.workspaceId} = ${report.workspaceId})`,
      ),
      exists(sql`(SELECT 1 FROM ${projectGuest} WHERE ${projectGuest.userId} = ${userId} AND ${projectGuest.projectId} = ${report.projectId})`),
    ),
  )

export function listVisibleNotifications(db: Db, userId: string, opts: { unreadOnly: boolean; limit: number }) {
  return executor(db)
    .select({
      id: notification.id,
      kind: notification.kind,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      commentId: notification.commentId,
      body: comment.body,
      commentViaAgent: comment.viaAgent,
      notificationViaAgent: notification.viaAgent,
      noteBody: note.body,
      noteDeletedAt: note.deletedAt,
      workspaceId: report.workspaceId,
      report: { id: report.id, number: report.number, title: report.title },
      senderName: report.senderName,
      actorId: actor.id,
      actorName: actor.name,
      actorImage: actor.image,
    })
    .from(notification)
    .innerJoin(report, eq(report.id, notification.reportId))
    // A resolved notification has no comment.
    .leftJoin(comment, eq(comment.id, notification.commentId))
    .leftJoin(note, eq(note.id, notification.noteCommentId))
    .leftJoin(actor, eq(actor.id, notification.actorId))
    .where(opts.unreadOnly ? and(visible(userId), isNull(notification.readAt)) : visible(userId))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(opts.limit)
}

export async function countVisibleUnread(db: Db, userId: string): Promise<number> {
  const [unread] = await executor(db)
    .select({ value: count() })
    .from(notification)
    .innerJoin(report, eq(report.id, notification.reportId))
    .where(and(visible(userId), isNull(notification.readAt)))
  return unread?.value ?? 0
}

/** Names of these people in each of these workspaces they belong to, as a member or a guest of one of its projects. */
export async function memberNames(db: Db, workspaceIds: string[], userIds: string[]) {
  const members = await executor(db)
    .select({ workspaceId: workspaceMember.workspaceId, id: user.id, name: user.name })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(inArray(workspaceMember.workspaceId, workspaceIds), inArray(workspaceMember.userId, userIds)))
  const guests = await executor(db)
    .selectDistinct({ workspaceId: project.workspaceId, id: user.id, name: user.name })
    .from(projectGuest)
    .innerJoin(project, eq(project.id, projectGuest.projectId))
    .innerJoin(user, eq(user.id, projectGuest.userId))
    .where(and(inArray(project.workspaceId, workspaceIds), inArray(projectGuest.userId, userIds)))
  return [...members, ...guests]
}

export async function markAllRead(db: Db, userId: string): Promise<void> {
  await executor(db)
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
}

/** The caller's own notification, or null for none or someone else's. */
export async function findOwnNotification(db: Db, userId: string, id: string) {
  const [row] = await executor(db)
    .select({ readAt: notification.readAt })
    .from(notification)
    .where(and(eq(notification.id, id), eq(notification.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function markRead(db: Db, id: string): Promise<void> {
  await executor(db).update(notification).set({ readAt: new Date() }).where(eq(notification.id, id))
}
