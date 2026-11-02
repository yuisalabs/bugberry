import type { AppDeps } from "../../deps"
import type { CurrentUser } from "../../plugins/auth"
import { notFound } from "../../lib/errors"
import { fixLinkLabel } from "@bugberry/shared"
import { mentionedIds, snippetOf } from "../comments/mentions"
import { listFixesOf } from "../reports/repository"
import { countVisibleUnread, findOwnNotification, listVisibleNotifications, markAllRead, markRead, memberNames } from "./repository"

const LIMIT = 50

/** The bell: mentions, replies in the caller's threads and their resolved reports, only in workspaces they still belong to. */
export async function listNotifications(
  { db }: Pick<AppDeps, "db">,
  current: CurrentUser,
  opts: { unreadOnly?: boolean; limit?: number } = {},
) {
  const rows = await listVisibleNotifications(db, current.id, {
    unreadOnly: opts.unreadOnly ?? false,
    limit: opts.limit ?? LIMIT,
  })
  const unreadCount = await countVisibleUnread(db, current.id)

  // Names are looked up per workspace: a token only shows a name for a member of that workspace.
  const ids = [...new Set(rows.flatMap((row) => mentionedIds(row.body ?? "")))]
  const workspaces = [...new Set(rows.map((row) => row.workspaceId))]
  const members = ids.length === 0 ? [] : await memberNames(db, workspaces, ids)
  const namesIn = (workspaceId: string) =>
    new Map(members.filter((member) => member.workspaceId === workspaceId).map((member) => [member.id, member.name]))

  // A resolved row says where the report was fixed, as it stands now.
  const resolvedIds = [...new Set(rows.filter((row) => row.kind === "resolved").map((row) => row.report.id))]
  const fixes = await listFixesOf(db, resolvedIds)
  const fixedIn = (reportId: string) => {
    const labels = fixes.filter((fix) => fix.reportId === reportId).map((fix) => fixLinkLabel(fix.url).label)
    return labels.length > 0 ? `Fixed in ${labels.join(", ")}` : "Resolved"
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      read: row.readAt !== null,
      createdAt: row.createdAt,
      actor: row.actorId ? { id: row.actorId, name: row.actorName ?? "", image: row.actorImage ?? null } : null,
      report: row.report,
      commentId: row.commentId,
      snippet: row.kind === "resolved" ? fixedIn(row.report.id) : snippetOf(row.body ?? "", namesIn(row.workspaceId)),
      viaAgent: row.notificationViaAgent ?? row.commentViaAgent,
    })),
    unreadCount,
  }
}

export type NotificationView = Awaited<ReturnType<typeof listNotifications>>["items"][number]

export async function markAllNotificationsRead({ db }: Pick<AppDeps, "db">, current: CurrentUser) {
  await markAllRead(db, current.id)
  return { ok: true as const }
}

export async function markNotificationRead({ db }: Pick<AppDeps, "db">, current: CurrentUser, id: string) {
  const row = await findOwnNotification(db, current.id, id)
  if (!row) throw notFound("notification_not_found", "Notification not found")
  if (!row.readAt) await markRead(db, id)
  return { ok: true as const }
}
