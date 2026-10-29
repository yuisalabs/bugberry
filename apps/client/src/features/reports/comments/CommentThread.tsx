import type { WorkspaceRole } from "@bugberry/shared"
import { useState } from "react"
import { type Mentionable, mentionLabel } from "./mentions"
import { CommentComposer } from "./CommentComposer"
import { CommentItem } from "./CommentItem"
import type { Comment, CommentThread as Thread } from "../queries"

/**
 * A thread: its first comment, the replies under it (oldest first), and a reply box at the bottom while someone
 * answers. Replying to a reply stays in this thread and starts with that person mentioned.
 */
export function CommentThread({
  thread,
  people,
  me,
  busy,
  onAdd,
  onEdit,
  onDelete,
  onReact,
}: {
  thread: Thread
  people: Mentionable[]
  me: { id: string; role: WorkspaceRole; name?: string; image?: string | null }
  busy: boolean
  onAdd(body: string, replyTo?: string): Promise<unknown>
  onEdit(id: string, body: string): Promise<unknown>
  onDelete(id: string): void
  onReact(commentId: string, emoji: string): void
}) {
  const [answering, setAnswering] = useState<Comment | null>(null)
  const item = (comment: Comment, reply: boolean) => (
    <CommentItem
      key={comment.id}
      comment={comment}
      people={people}
      me={me}
      busy={busy}
      reply={reply}
      onEdit={onEdit}
      onDelete={onDelete}
      onReact={onReact}
      onReply={setAnswering}
    />
  )
  // Answering someone's reply starts with them mentioned; answering the first comment starts empty.
  const author = answering?.parentId ? answering.author : null
  const mention = author && author.id !== me.id ? people.find((person) => person.id === author.id) : undefined
  const label = mention ? mentionLabel(mention, people) : null

  return (
    <article className="flex flex-col gap-3">
      {item(thread, false)}
      {(thread.replies.length > 0 || answering) && (
        <div className="ml-4 flex flex-col gap-3 border-l-2 border-border pl-3 sm:ml-[15px] sm:pl-5">
          {thread.replies.map((reply) => item(reply, true))}
          {answering && (
            <CommentComposer
              key={answering.id}
              me={me}
              people={people}
              busy={busy}
              label="Reply"
              sendLabel="Post reply"
              placeholder="Write a reply"
              autoFocus
              initial={mention && label ? { text: `@${label} `, picked: [{ id: mention.id, name: mention.name, label }] } : undefined}
              onSubmit={(body) => onAdd(body, answering.id).then(() => setAnswering(null))}
            />
          )}
        </div>
      )}
    </article>
  )
}
