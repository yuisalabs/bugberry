import type { WorkspaceRole } from "@bugberry/shared"
import { type FormEvent, useState } from "react"
import { Button } from "@bugberry/ui/button"
import type { Comment } from "../lib/api"
import { formatDateTime } from "../lib/format"
import { commentParts, type Mentionable, type Picked, toEditable, toStored } from "../lib/mentions"
import { MentionTextarea } from "./MentionTextarea"

interface Props {
  comments: Comment[]
  /** Who can be mentioned: the members of the report's workspace. */
  people?: Mentionable[]
  me: { id: string; role: WorkspaceRole }
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
  const mine = comment.author.id === me.id
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
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">{comment.author.name}</span>
          {comment.viaAgent && (
            <span
              title={`Written by ${comment.viaAgent} for ${comment.author.name}`}
              className="ml-2 rounded-full bg-primary-subtle px-1.5 py-0.5 text-[11px] font-medium text-primary-subtle-foreground"
            >
              via AI
            </span>
          )}
          <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
        </p>
        <div className="flex gap-1">
          {mine && draft === null && (
            <Button size="sm" intent="plain" isDisabled={busy} onPress={startEditing}>
              Edit
            </Button>
          )}
          {(mine || me.role === "admin") && (
            <Button size="sm"
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
      <h2 className="text-lg font-semibold">Comments</h2>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
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
      <form onSubmit={submit} className="flex flex-col gap-2">
        <MentionTextarea
          label="New comment"
          value={text}
          onChange={setText}
          people={people}
          selfId={me.id}
          onPick={(person) => setPicked((current) => addPicked(current, person))}
          placeholder="Write a comment or @ to mention"
        />
        <Button size="sm" type="submit" className="self-start" isDisabled={busy || !text.trim()}>
          Post comment
        </Button>
      </form>
    </section>
  )
}
