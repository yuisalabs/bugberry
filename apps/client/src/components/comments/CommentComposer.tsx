import { RiAtLine, RiEmotionLine, RiSendPlane2Line } from "@remixicon/react"
import { type FormEvent, useRef, useState } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { Button } from "@bugberry/ui/button"
import { type Mentionable, type Picked, toStored } from "../../lib/mentions"
import { initialsOf } from "../../lib/people"
import { MentionTextarea, type MentionTextareaHandle } from "../MentionTextarea"
import { EmojiPicker } from "./EmojiPicker"

/** Picked people, once each. */
export const addPicked = (picked: Picked[], person: Picked) => [...picked.filter((known) => known.id !== person.id), person]

/**
 * One box for a comment or a reply: the writer's avatar, the text (it grows as it is typed), @ and emoji
 * buttons, and Send, which turns primary once there is something to send. The text stays until the save
 * resolves, so a failed save loses nothing.
 */
export function CommentComposer({
  me,
  people,
  busy,
  label,
  sendLabel,
  placeholder,
  initial,
  autoFocus,
  onSubmit,
}: {
  me: { id: string; name?: string; image?: string | null }
  people: Mentionable[]
  busy: boolean
  /** The box's accessible name: "New comment", or "Reply". */
  label: string
  sendLabel: string
  placeholder: string
  /** Text to start with, such as "@Ana " when answering Ana's reply, with the people it already mentions. */
  initial?: { text: string; picked: Picked[] }
  autoFocus?: boolean
  onSubmit(body: string): Promise<unknown>
}) {
  const [text, setText] = useState(initial?.text ?? "")
  const [picked, setPicked] = useState<Picked[]>(initial?.picked ?? [])
  const box = useRef<MentionTextareaHandle>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    onSubmit(toStored(body, picked)).then(
      () => {
        setText("")
        setPicked([])
      },
      () => {},
    )
  }
  const ready = Boolean(text.trim())

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-1.5 rounded-xl border border-input bg-background p-1.5 focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/20"
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
          handle={box}
          label={label}
          value={text}
          onChange={setText}
          people={people}
          selfId={me.id}
          onPick={(person) => setPicked((current) => addPicked(current, person))}
          placeholder={placeholder}
          rows={1}
          autoFocus={autoFocus}
          className="min-h-9 resize-none border-0 bg-transparent px-1 focus:ring-0 sm:px-1"
        />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 self-center">
        <Button
          intent="plain"
          size="sq-xs"
          aria-label="Mention someone"
          onPress={() => box.current?.insert(text && !/\s$/.test(text) ? " @" : "@")}
        >
          <RiAtLine aria-hidden />
        </Button>
        <EmojiPicker label="Insert emoji" trigger={<RiEmotionLine aria-hidden />} onPick={(emoji) => box.current?.insert(emoji)} />
        <Button size="sq-sm" intent={ready ? "primary" : "secondary"} type="submit" aria-label={sendLabel} isDisabled={busy || !ready}>
          <RiSendPlane2Line aria-hidden />
        </Button>
      </div>
    </form>
  )
}
