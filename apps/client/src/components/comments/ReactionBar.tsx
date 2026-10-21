import { RiEmotionLine } from "@remixicon/react"
import { useEffect, useRef, useState } from "react"
import { Tooltip, TooltipTrigger } from "@bugberry/ui/tooltip"
import type { Reaction } from "../../lib/api"
import { EmojiPicker } from "./EmojiPicker"

/** How long a press on a phone takes to show who reacted, instead of toggling the reaction. */
const LONG_PRESS_MS = 500

/** "Ana", "Ana and Budi", "Ana, Budi and Citra". */
function names(people: { name: string }[]): string {
  const list = people.map((person) => person.name)
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`
}

/** One emoji with its count; pressing toggles yours. Hovering, focusing or a long press shows who reacted. */
function ReactionChip({ reaction, mine, onToggle }: { reaction: Reaction; mine: boolean; onToggle(): void }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])
  const who = names(reaction.people)
  return (
    <TooltipTrigger isOpen={open} onOpenChange={setOpen} delay={300}>
      <button
        type="button"
        aria-pressed={mine}
        aria-label={`${reaction.emoji} ${reaction.count}, ${who} reacted`}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return
          longPressed.current = false
          timer.current = setTimeout(() => {
            longPressed.current = true
            setOpen(true)
          }, LONG_PRESS_MS)
        }}
        onPointerUp={() => clearTimeout(timer.current ?? undefined)}
        onPointerLeave={() => clearTimeout(timer.current ?? undefined)}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false
            return
          }
          onToggle()
        }}
        className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs font-medium outline-hidden transition select-none focus-visible:ring-2 focus-visible:ring-ring ${
          mine ? "border-primary/30 bg-primary-subtle text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted"
        }`}
      >
        <span className="text-sm">{reaction.emoji}</span>
        {reaction.count}
      </button>
      <Tooltip>{`${who} reacted with ${reaction.emoji}`}</Tooltip>
    </TooltipTrigger>
  )
}

/** A comment's reactions, then the button to add one. */
export function ReactionBar({
  reactions,
  meId,
  onReact,
}: {
  reactions: Reaction[]
  meId: string
  onReact(emoji: string): void
}) {
  return (
    <>
      {reactions.map((reaction) => (
        <ReactionChip
          key={reaction.emoji}
          reaction={reaction}
          mine={reaction.people.some((person) => person.id === meId)}
          onToggle={() => onReact(reaction.emoji)}
        />
      ))}
      <EmojiPicker
        label="Add reaction"
        trigger={<RiEmotionLine aria-hidden />}
        onPick={onReact}
        className="h-7 w-8 rounded-full border border-border text-muted-foreground"
      />
    </>
  )
}
