import { and, count, desc, eq, inArray, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { comment, notification, report, user, workspaceMember } from "../../db/schema"
import { notFound } from "../../lib/errors"
import { mentionedIds, snippetOf } from "../comments/mentions"

const LIMIT = 50

const actor = alias(user, "actor")
const caller = alias(workspaceMember, "caller")

/** The bell: mentions of the caller, only in workspaces they still belong to. */
export function notificationsModule(deps: AppDeps) {
  const { db } = deps
  /** Rows of the caller's that sit in a workspace the caller is still a member of. */
  const visible = (userId: string) =>
    and(eq(notification.userId, userId), eq(caller.userId, userId), eq(caller.workspaceId, report.workspaceId))

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/notifications",
      async ({ user: current }) => {
        const rows = await db
          .select({
            id: notification.id,
            readAt: notification.readAt,
            createdAt: notification.createdAt,
            commentId: notification.commentId,
            body: comment.body,
            workspaceId: report.workspaceId,
            report: { id: report.id, number: report.number, title: report.title },
            actorId: actor.id,
            actorName: actor.name,
            actorImage: actor.image,
          })
          .from(notification)
          .innerJoin(report, eq(report.id, notification.reportId))
          .innerJoin(caller, eq(caller.workspaceId, report.workspaceId))
          .innerJoin(comment, eq(comment.id, notification.commentId))
          .leftJoin(actor, eq(actor.id, notification.actorId))
          .where(visible(current.id))
          .orderBy(desc(notification.createdAt), desc(notification.id))
          .limit(LIMIT)

        const [unread] = await db
          .select({ value: count() })
          .from(notification)
          .innerJoin(report, eq(report.id, notification.reportId))
          .innerJoin(caller, eq(caller.workspaceId, report.workspaceId))
          .where(and(visible(current.id), isNull(notification.readAt)))

        // Names are looked up per workspace: a token only shows a name for a member of that workspace.
        const ids = [...new Set(rows.flatMap((row) => mentionedIds(row.body)))]
        const workspaces = [...new Set(rows.map((row) => row.workspaceId))]
        const members =
          ids.length === 0
            ? []
            : await db
                .select({ workspaceId: workspaceMember.workspaceId, id: user.id, name: user.name })
                .from(workspaceMember)
                .innerJoin(user, eq(user.id, workspaceMember.userId))
                .where(and(inArray(workspaceMember.workspaceId, workspaces), inArray(workspaceMember.userId, ids)))
        const namesIn = (workspaceId: string) =>
          new Map(members.filter((member) => member.workspaceId === workspaceId).map((member) => [member.id, member.name]))

        return {
          items: rows.map((row) => ({
            id: row.id,
            read: row.readAt !== null,
            createdAt: row.createdAt,
            actor: row.actorId ? { id: row.actorId, name: row.actorName ?? "", image: row.actorImage ?? null } : null,
            report: row.report,
            commentId: row.commentId,
            snippet: snippetOf(row.body, namesIn(row.workspaceId)),
          })),
          unreadCount: unread?.value ?? 0,
        }
      },
      { auth: true },
    )
    .post(
      "/notifications/read-all",
      async ({ user: current }) => {
        await db
          .update(notification)
          .set({ readAt: new Date() })
          .where(and(eq(notification.userId, current.id), isNull(notification.readAt)))
        return { ok: true }
      },
      { auth: true },
    )
    .post(
      "/notifications/:id/read",
      async ({ user: current, params }) => {
        const [row] = await db
          .select({ readAt: notification.readAt })
          .from(notification)
          .where(and(eq(notification.id, params.id), eq(notification.userId, current.id)))
          .limit(1)
        if (!row) throw notFound("notification_not_found", "Notification not found")
        if (!row.readAt) await db.update(notification).set({ readAt: new Date() }).where(eq(notification.id, params.id))
        return { ok: true }
      },
      { auth: true },
    )
}
