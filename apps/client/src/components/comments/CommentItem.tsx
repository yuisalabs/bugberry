import type { WorkspaceRole } from "@bugberry/shared"
import { RiMoreLine, RiPlayFill } from "@remixicon/react"
import { useContext, useState } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Button } from "@bugberry/ui/button"
import { Menu, MenuItem, MenuTrigger } from "@bugberry/ui/menu"
import { useNow } from "../../hooks/useNow"
import type { Comment } from "../../lib/api"
import { videoTimes } from "../../lib/comment-feed"
import { formatDateTime, formatRelative } from "../../lib/format"
import { commentParts, type Mentionable, type Picked, toEditable, toStored } from "../../lib/mentions"
import { initialsOf } from "../../lib/people"
import { workspaceColor } from "../../features/workspaces/workspace"
import { MentionTextarea } from "../MentionTextarea"
import { ReportVideoContext } from "../../features/reports/detail/video-context"
import { addPicked } from "./CommentComposer"
import { ReactionBar } from "./ReactionBar"

/** Text with "0:52"-style times as buttons that seek the report's video (only on a video report). */
function TimedText({ text }: { text: string }) {
  const video = useContext(ReportVideoContext)
  return (
    <>
      {videoTimes(text, video?.durationMs ?? null).map((part, index) =>
        "text" in part ? (
          part.text
        ) : (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
            key={index}
            type="button"
            aria-label={`Play from ${part.time}`}
            onClick={() => video?.seek(part.ms)}
            className="mx-0.5 inline-flex items-center gap-0.5 rounded-md bg-foreground px-1.5 align-baseline font-mono text-xs leading-5 font-semibold text-background hover:bg-foreground/85"
          >
            <RiPlayFill aria-hidden className="size-3" />
            {part.time}
          </button>
        ),
      )}
    </>
  )
}

/** The comment text with mentions as highlighted names; React escapes everything else. */
function CommentBody({ comment }: { comment: Comment }) {
  const names = new Map(comment.mentions.map((person) => [person.id, person.name]))
  return (
    <p className="mt-1 text-sm whitespace-pre-wrap break-words text-foreground">
      {commentParts(comment.body, names).map((part, index) =>
        "text" in part ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <TimedText key={index} text={part.text} />
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

/**
 * One comment in the feed: avatar, name, "You", time, "edited", "via AI" and a ⋯ menu (Edit for its author,
 * Delete for its author or an admin), then the text, its reactions and Reply. A deleted first comment kept for
 * its replies reads "This comment was deleted" and offers nothing.
 */
export function CommentItem({
  comment,
  people,
  me,
  busy,
  reply = false,
  onEdit,
  onDelete,
  onReact,
  onReply,
}: {
  comment: Comment
  people: Mentionable[]
  me: { id: string; role: WorkspaceRole }
  busy: boolean
  /** A reply: a smaller avatar, under its thread. */
  reply?: boolean
  onEdit(id: string, body: string): Promise<unknown>
  onDelete(id: string): void
  onReact(commentId: string, emoji: string): void
  onReply(comment: Comment): void
}) {
  const now = useNow()
  const { confirm, dialog } = useConfirm()
  const [draft, setDraft] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked[]>([])
  const author = comment.author
  const mine = author?.id === me.id
  const canDelete = mine || me.role === "admin"

  if (comment.deleted || !author) {
    return (
      <div id={`comment-${comment.id}`} className="flex scroll-mt-24 items-center gap-2.5">
        <span aria-hidden className={`shrink-0 rounded-full bg-muted ${reply ? "size-6" : "size-8"}`} />
        <p className="text-sm text-muted-foreground italic">This comment was deleted</p>
      </div>
    )
  }

  const startEditing = () => {
    const editable = toEditable(comment.body, new Map(comment.mentions.map((person) => [person.id, person.name])), people)
    setPicked(editable.picked)
    setDraft(editable.text)
  }
  const save = () => {
    const text = draft?.trim()
    const body = text ? toStored(text, picked) : ""
    if (!body) return setDraft(null)
    onEdit(comment.id, body).then(
      () => setDraft(null),
      () => {},
    )
  }

  return (
    <div id={`comment-${comment.id}`} className="flex scroll-mt-24 gap-2.5">
      <Avatar
        src={author.image}
        initials={initialsOf(author.name)}
        alt=""
        size={reply ? "sm" : "md"}
        className={`shrink-0 ${author.image ? "" : `${workspaceColor(author.id)} text-white`}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 items-center gap-2">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="font-semibold text-foreground">{author.name}</span>
            {mine && <span className="rounded-md bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">You</span>}
            {comment.viaAgent && (
              <span
                title={`Written by ${comment.viaAgent} for ${author.name}`}
                className="rounded-full bg-primary-subtle px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-primary-subtle-foreground"
              >
                via AI
              </span>
            )}
            <time dateTime={new Date(comment.createdAt).toISOString()} title={formatDateTime(comment.createdAt)} className="text-xs text-muted-foreground">
              {formatRelative(comment.createdAt, now)}
              {comment.edited ? " · edited" : ""}
            </time>
          </p>
          {canDelete && draft === null && (
            <MenuTrigger>
              <Button intent="plain" size="sq-xs" aria-label="Comment actions" className="ml-auto text-muted-foreground">
                <RiMoreLine aria-hidden />
              </Button>
              <Menu placement="bottom end" className="min-w-36">
                {mine ? (
                  <MenuItem onAction={startEditing} textValue="Edit">
                    Edit
                  </MenuItem>
                ) : null}
                <MenuItem
                  intent="danger"
                  textValue="Delete"
                  onAction={async () => {
                    const yes = await confirm({
                      title: "Delete this comment?",
                      description: "It's removed for everyone in the workspace.",
                      confirmLabel: "Delete",
                    })
                    if (yes) onDelete(comment.id)
                  }}
                >
                  Delete
                </MenuItem>
              </Menu>
            </MenuTrigger>
          )}
        </div>
        {draft === null ? (
          <>
            <CommentBody comment={comment} />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <ReactionBar reactions={comment.reactions} meId={me.id} onReact={(emoji) => onReact(comment.id, emoji)} />
              <Button intent="plain" size="xs" onPress={() => onReply(comment)} className="text-muted-foreground">
                Reply
              </Button>
            </div>
          </>
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
      </div>
      {dialog}
    </div>
  )
}
