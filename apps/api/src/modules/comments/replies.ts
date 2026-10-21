import { and, eq, inArray, ne, or } from "drizzle-orm"
import type { Db } from "../../db/client"
import { comment, notification, workspaceMember } from "../../db/schema"
import { newId } from "../../lib/ids"

/**
 * Tells a thread about a reply: the thread's first author ("replied to your comment") and everyone who replied
 * before ("replied in a thread you're in"). Not the replier, nobody who left the workspace, and nobody already
 * notified about this comment, so a mention made in the reply stays a mention. Bell only, no email.
 */
export async function notifyReplies(
  db: Db,
  input: { commentId: string; reportId: string; workspaceId: string; actorId: string; rootId: string },
): Promise<void> {
  const thread = await db
    .select({ authorId: comment.authorId, parentId: comment.parentId })
    .from(comment)
    .where(and(or(eq(comment.id, input.rootId), eq(comment.parentId, input.rootId)), ne(comment.id, input.commentId)))
  const rootAuthor = thread.find((row) => row.parentId === null)?.authorId
  const people = [...new Set(thread.map((row) => row.authorId))].filter((id) => id !== input.actorId)
  if (people.length === 0) return
  const members = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, input.workspaceId), inArray(workspaceMember.userId, people)))
  if (members.length === 0) return
  await db
    .insert(notification)
    .values(
      members.map(({ userId }) => ({
        id: newId(),
        userId,
        commentId: input.commentId,
        reportId: input.reportId,
        actorId: input.actorId,
        kind: userId === rootAuthor ? ("reply_to_you" as const) : ("reply_in_thread" as const),
      })),
    )
    .onConflictDoNothing({ target: [notification.userId, notification.commentId] })
}
