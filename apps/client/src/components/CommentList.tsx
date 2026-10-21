import type { WorkspaceRole } from "@bugberry/shared"
import { RiSendPlane2Line } from "@remixicon/react"
import { type FormEvent, useState } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { Button } from "@bugberry/ui/button"
import type { Comment } from "../lib/api"
import { formatDateTime } from "../lib/format"
import { commentParts, type Mentionable, type Picked, toEditable, toStored } from "../lib/mentions"
import { initialsOf } from "../lib/people"
import { MentionTextarea } from "./MentionTextarea"

interface Props {
  comments: Comment[]
  /** Who can be mentioned: the members of the report's workspace. */
  people?: Mentionable[]
  /** The person writing; their name and photo show beside the new comment box. */
  me: { id: string; role: WorkspaceRole; name?: string; image?: string | null }
  busy: boolean
  /** Resolves when saved; the typed text is kept until then, so a failed save loses nothing. */
  onAdd(body: string): Promise<unknown>
  onEdit(id: string, body: string): Promise<unknown>
  onDelete(id: string): void
}

/** Picked people, once each. */
const addPicked = (picked: Picked[], person: Picked) => [...picked.filter((known) => known.id !== person.id), person]

/** The comment text with mentions as highlighted names; React escapes everything else. */
function CommentBody({ comment }: { comment: Comment }) {
  const names = new Map(comment.mentions.map((person) => [person.id, person.name]))
  return (
    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
      {commentParts(comment.body, names).map((part, index) =>
        "text" in part ? (
          part.text
        ) : part.mention ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <span key={index} className="rounded bg-primary-subtle px-1 font-medium text-primary-subtle-foreground">
            @{part.mention.name}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <span key={index} className="text-muted-foreground">
            @former member
          </span>
        ),
      )}
    </p>
  )
}

function CommentItem({
  comment,
  people,
  me,
  busy,
  onEdit,
  onDelete,
}: { comment: Comment; people: Mentionable[] } & Omit<Props, "comments" | "onAdd" | "people">) {
  const [draft, setDraft] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked[]>([])
  const mine = comment.author?.id === me.id
  const startEditing = () => {
    const editable = toEditable(comment.body, new Map(comment.mentions.map((person) => [person.id, person.name])), people)
    setPicked(editable.picked)
    setDraft(editable.text)
  }
  const save = () => {
    const text = draft?.trim()
    const body = text ? toStored(text, picked) : ""
    if (!body || body === comment.body) return setDraft(null)
    onEdit(comment.id, body).then(
      () => setDraft(null),
      () => {},
    )
  }

  return (
    <li id={`comment-${comment.id}`} className="scroll-mt-24 rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span className="font-medium">{comment.author?.name}</span>
          {comment.viaAgent && (
            <span
              title={`Written by ${comment.viaAgent} for ${comment.author?.name}`}
              className="ml-2 inline-block rounded-full bg-primary-subtle px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-primary-subtle-foreground"
            >
              via AI
            </span>
          )}
          <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
        </p>
        <div className="flex gap-1">
          {mine && draft === null && (
            <Button size="xs" intent="plain" isDisabled={busy} onPress={startEditing}>
              Edit
            </Button>
          )}
          {(mine || me.role === "admin") && (
            <Button
              size="xs"
              intent="plain"
              isDisabled={busy}
              onPress={() => {
                if (window.confirm("Delete this comment?")) onDelete(comment.id)
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      {draft === null ? (
        <CommentBody comment={comment} />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <MentionTextarea
            label="Edit comment"
            value={draft}
            onChange={setDraft}
            people={people}
            selfId={me.id}
            onPick={(person) => setPicked((current) => addPicked(current, person))}
          />
          <div className="flex gap-2">
            <Button size="sm" isDisabled={busy || !draft.trim()} onPress={save}>
              Save
            </Button>
            <Button size="sm" intent="outline" onPress={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Comments are plain text: React escapes them, and line breaks are kept with pre-wrap. */
export function CommentList({ comments, people = [], me, busy, onAdd, onEdit, onDelete }: Props) {
  const [text, setText] = useState("")
  const [picked, setPicked] = useState<Picked[]>([])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    onAdd(toStored(body, picked)).then(
      () => {
        setText("")
        setPicked([])
      },
      () => {},
    )
  }

  return (
    <section aria-label="Comments" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
        Comments
        <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">{comments.length}</span>
      </h2>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              people={people}
              me={me}
              busy={busy}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
      {/* One box: who is writing, the text (it grows as it is typed) and the send button. */}
      <form
        onSubmit={submit}
        className="flex items-end gap-2 rounded-xl border border-input bg-background p-1.5 focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/20"
      >
        {me.name && (
          <Avatar
            src={me.image}
            initials={initialsOf(me.name)}
            alt=""
            size="sm"
            className="ml-0.5 shrink-0 self-center bg-primary text-primary-foreground"
          />
        )}
        <div className="min-w-0 flex-1">
          <MentionTextarea
            label="New comment"
            value={text}
            onChange={setText}
            people={people}
            selfId={me.id}
            onPick={(person) => setPicked((current) => addPicked(current, person))}
            placeholder="Comment or @ to mention"
            rows={1}
            className="min-h-9 resize-none border-0 bg-transparent px-1 focus:ring-0 sm:px-1"
          />
        </div>
        <Button
          size="sq-sm"
          // Pink once there is something to send; grey while the box is empty.
          intent={text.trim() ? "primary" : "secondary"}
          type="submit"
          aria-label="Post comment"
          className="shrink-0"
          isDisabled={busy || !text.trim()}
        >
          <RiSendPlane2Line aria-hidden />
        </Button>
      </form>
    </section>
  )
}
