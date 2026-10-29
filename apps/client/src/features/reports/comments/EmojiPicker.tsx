import { EmojiPicker as Frimousse } from "frimousse"
import { type ReactNode, useState } from "react"
import { Dialog, DialogTrigger } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Popover } from "@bugberry/ui/popover"
import { readRecentEmoji, rememberEmoji, saveRecentEmoji } from "./recent-emoji"

/**
 * A button that opens every emoji, searchable, with this browser's recently used ones first. Picking one calls
 * `onPick`, remembers it and closes. The full list loads from the emoji data's CDN when the picker first opens.
 */
export function EmojiPicker({
  label,
  trigger,
  onPick,
  className,
}: {
  /** The button's accessible name, such as "Add reaction" or "Insert emoji". */
  label: string
  trigger: ReactNode
  onPick(emoji: string): void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const pick = (emoji: string) => {
    const next = rememberEmoji(readRecentEmoji(), emoji)
    saveRecentEmoji(next)
    setRecent(next)
    setOpen(false)
    onPick(emoji)
  }
  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        if (next) setRecent(readRecentEmoji())
        setOpen(next)
      }}
    >
      <Button intent="plain" size="sq-xs" aria-label={label} className={className}>
        {trigger}
      </Button>
      <Popover placement="bottom start" className="max-w-none">
        <Dialog aria-label={label} className="outline-hidden">
          <div className="flex w-72 flex-col">
            {recent.length > 0 && (
              <div role="group" aria-label="Recently used" className="flex flex-wrap gap-0.5 border-b border-border p-1.5">
                {recent.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={emoji}
                    onClick={() => pick(emoji)}
                    className="grid size-8 place-items-center rounded-md text-lg outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            <Frimousse.Root onEmojiSelect={({ emoji }) => pick(emoji)} columns={8} className="isolate flex h-72 flex-col">
              <Frimousse.Search
                placeholder="Search emoji"
                className="m-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground outline-hidden placeholder:text-muted-foreground focus:border-ring/70"
              />
              <Frimousse.Viewport className="relative flex-1 outline-hidden">
                <Frimousse.Loading className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                  Loading emoji…
                </Frimousse.Loading>
                <Frimousse.Empty className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                  No emoji found
                </Frimousse.Empty>
                <Frimousse.List
                  className="pb-1.5 select-none"
                  components={{
                    CategoryHeader: ({ category, ...props }) => (
                      <div {...props} className="bg-overlay px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                        {category.label}
                      </div>
                    ),
                    Row: ({ children, ...props }) => (
                      <div {...props} className="scroll-my-1.5 px-1.5">
                        {children}
                      </div>
                    ),
                    Emoji: ({ emoji, ...props }) => (
                      <button {...props} className="grid size-8 place-items-center rounded-md text-lg data-active:bg-muted">
                        {emoji.emoji}
                      </button>
                    ),
                  }}
                />
              </Frimousse.Viewport>
            </Frimousse.Root>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
