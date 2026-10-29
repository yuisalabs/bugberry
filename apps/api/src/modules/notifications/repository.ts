import { and, count, desc, eq, inArray, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { type Db, executor } from "../../db/client"
import { comment, notification, report, user, workspaceMember } from "../../db/schema"

const actor = alias(user, "actor")
const callerMember = alias(workspaceMember, "caller")

/** Rows of the caller's that sit in a workspace the caller is still a member of. */
const visible = (userId: string) =>
  and(eq(notification.userId, userId), eq(callerMember.userId, userId), eq(callerMember.workspaceId, report.workspaceId))

export function listVisibleNotifications(db: Db, userId: string, opts: { unreadOnly: boolean; limit: number }) {
  return executor(db)
    .select({
      id: notification.id,
      kind: notification.kind,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      commentId: notification.commentId,
      body: comment.body,
      viaAgent: comment.viaAgent,
      workspaceId: report.workspaceId,
      report: { id: report.id, number: report.number, title: report.title },
      actorId: actor.id,
      actorName: actor.name,
      actorImage: actor.image,
    })
    .from(notification)
    .innerJoin(report, eq(report.id, notification.reportId))
    .innerJoin(callerMember, eq(callerMember.workspaceId, report.workspaceId))
    .innerJoin(comment, eq(comment.id, notification.commentId))
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
    .innerJoin(callerMember, eq(callerMember.workspaceId, report.workspaceId))
    .where(and(visible(userId), isNull(notification.readAt)))
  return unread?.value ?? 0
}

/** Names of these people in each of these workspaces they belong to. */
export function memberNames(db: Db, workspaceIds: string[], userIds: string[]) {
  return executor(db)
    .select({ workspaceId: workspaceMember.workspaceId, id: user.id, name: user.name })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(inArray(workspaceMember.workspaceId, workspaceIds), inArray(workspaceMember.userId, userIds)))
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
