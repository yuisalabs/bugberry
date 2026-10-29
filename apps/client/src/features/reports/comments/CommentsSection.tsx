import type { WorkspaceRole } from "@bugberry/shared"
import { commentCount, mergeFeed } from "./comment-feed"
import type { Mentionable } from "./mentions"
import { ActivityLine } from "./ActivityLine"
import { CommentComposer } from "./CommentComposer"
import { CommentThread } from "./CommentThread"
import type { Activity, CommentThread as Thread } from "../queries"

/**
 * The report's discussion: the heading with its count and the Comments only / All activity switch, the comment
 * box, then threads newest first, with what happened to the report between them under All activity.
 */
export function CommentsSection({
  threads,
  activity,
  people,
  me,
  busy,
  showActivity,
  onShowActivity,
  onAdd,
  onEdit,
  onDelete,
  onReact,
}: {
  threads: Thread[]
  /** The report's activity; null while it is not loaded (Comments only). */
  activity: Activity[] | null
  /** Who can be mentioned: the members of the report's workspace. */
  people: Mentionable[]
  me: { id: string; role: WorkspaceRole; name?: string; image?: string | null }
  busy: boolean
  showActivity: boolean
  onShowActivity(on: boolean): void
  /** Resolves when saved; the typed text is kept until then, so a failed save loses nothing. */
  onAdd(body: string, replyTo?: string): Promise<unknown>
  onEdit(id: string, body: string): Promise<unknown>
  onDelete(id: string): void
  onReact(commentId: string, emoji: string): void
}) {
  const feed = mergeFeed(threads, showActivity ? activity : null)
  const tab = (on: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={showActivity === on}
      onClick={() => onShowActivity(on)}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap outline-hidden transition focus-visible:ring-2 focus-visible:ring-ring ${
        showActivity === on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )

  return (
    <section aria-label="Comments" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          Comments
          <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">{commentCount(threads)}</span>
        </h2>
        <div role="group" aria-label="Show" className="flex rounded-xl bg-muted p-1">
          {tab(false, "Comments only")}
          {tab(true, "All activity")}
        </div>
      </div>
      <CommentComposer
        me={me}
        people={people}
        busy={busy}
        label="New comment"
        sendLabel="Post comment"
        placeholder="Comment or @ to mention"
        onSubmit={(body) => onAdd(body, undefined)}
      />
      {feed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {feed.map((entry) =>
            entry.kind === "thread" ? (
              <CommentThread
                key={entry.thread.id}
                thread={entry.thread}
                people={people}
                me={me}
                busy={busy}
                onAdd={onAdd}
                onEdit={onEdit}
                onDelete={onDelete}
                onReact={onReact}
              />
            ) : (
              <ActivityLine key={entry.item.id} item={entry.item} />
            ),
          )}
        </div>
      )}
    </section>
  )
}
