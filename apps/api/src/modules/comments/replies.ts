import type { Db } from "../../db/client"
import { insertReplyNotifications, listThreadAuthors, workspaceMembersAmong } from "./repository"

/**
 * Tells a thread's first author and earlier repliers about a reply, in the bell only: never the replier, someone
 * who left, or anyone already notified about this comment (so a mention in the reply stays a mention).
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
