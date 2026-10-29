import type { Db } from "../../db/client"
import { insertReplyNotifications, listThreadAuthors, workspaceMembersAmong } from "./repository"

/**
 * Tells a thread about a reply: the thread's first author ("replied to your comment") and everyone who replied
 * before ("replied in a thread you're in"). Not the replier, nobody who left the workspace, and nobody already
 * notified about this comment, so a mention made in the reply stays a mention. Bell only, no email.
 */
export async function notifyReplies(
  db: Db,
  input: { commentId: string; reportId: string; workspaceId: string; actorId: string; rootId: string },
): Promise<void> {
  const thread = await listThreadAuthors(db, input.rootId, input.commentId)
  const rootAuthor = thread.find((row) => row.parentId === null)?.authorId
  const people = [...new Set(thread.map((row) => row.authorId))].filter((id) => id !== input.actorId)
  if (people.length === 0) return
  const members = await workspaceMembersAmong(db, input.workspaceId, people)
  if (members.length === 0) return
  await insertReplyNotifications(
    db,
    { commentId: input.commentId, reportId: input.reportId, actorId: input.actorId },
    members.map(({ userId }) => ({ userId, kind: userId === rootAuthor ? "reply_to_you" : "reply_in_thread" })),
  )
}
