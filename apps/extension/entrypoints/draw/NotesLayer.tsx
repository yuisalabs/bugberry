import { Input } from "@bugberry/ui/input"
import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import { FADE_MS, NOTE_LIFE_MS } from "../../lib/annotate/strokes"

export interface NotesLayerHandle {
  /** Takes every note off the screen; the notes already saved stay in the report. */
  clear(): void
}

interface Pin {
  key: number
  n: number | null
  x: number
  y: number
  text: string
}

/** A saved note, fading out like the strokes once it has been on screen long enough to read. */
function PinnedNote({ pin, author, onGone }: { pin: Pin; author: string; onGone(): void }) {
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const fade = setTimeout(() => setFading(true), NOTE_LIFE_MS - FADE_MS)
    const gone = setTimeout(onGone, NOTE_LIFE_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [])
  return (
    <div
      data-note
      className="pointer-events-none absolute flex items-start gap-2"
      style={{ left: pin.x - 14, top: pin.y - 14, opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms linear` }}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-background bg-primary text-sm font-bold text-primary-foreground shadow">
        {pin.n}
      </span>
      <span className="flex max-w-64 flex-col rounded-lg bg-foreground px-3 py-2 text-background shadow-lg">
        <span className="text-sm font-semibold">{pin.text}</span>
        <span className="text-xs text-background/60">{author ? `${author} · just now` : "just now"}</span>
      </span>
    </div>
  )
}

/**
 * Numbered notes pinned on the page while recording (recording-overlay.html): a magenta number and a dark
 * card with the text and who wrote it. Each fades a few seconds after it is saved; the report keeps it.
 */
export const NotesLayer = forwardRef<
  NotesLayerHandle,
  { active: boolean; author: string; addNote(text: string): Promise<{ n: number } | null> }
>(function NotesLayer({ active, author, addNote }, ref) {
  const [pins, setPins] = useState<Pin[]>([])
  const [draft, setDraft] = useState<Pin | null>(null)

  useImperativeHandle(ref, () => ({
    clear: () => {
      setPins([])
      setDraft(null)
    },
  }))

  const save = async () => {
    const text = draft?.text.trim() ?? ""
    if (!draft || !text) return
    const saved = await addNote(text)
    setDraft(null)
    if (saved) setPins((current) => [...current, { ...draft, text, n: saved.n }])
  }

  return (
    <div
      data-testid="notes-surface"
      className="fixed inset-0"
      style={{ pointerEvents: active ? "auto" : "none", cursor: active ? "crosshair" : "default" }}
      onPointerDown={(event) => {
        if (!active || event.target !== event.currentTarget) return
        setDraft({ key: Date.now(), n: null, x: event.clientX, y: event.clientY, text: "" })
      }}
      // The new input took focus on pointerdown; mousedown's default would hand it back to the surface.
      onMouseDown={(event) => {
        if (active && event.target === event.currentTarget) event.preventDefault()
      }}
    >
      {pins.map((pin) => (
        <PinnedNote key={pin.key} pin={pin} author={author} onGone={() => setPins((current) => current.filter((other) => other.key !== pin.key))} />
      ))}
      {draft && (
        <div className="absolute flex items-start gap-2" style={{ left: draft.x - 14, top: draft.y - 14 }}>
          <span className="size-7 shrink-0 rounded-full border-2 border-background bg-primary shadow" />
          <Input
            autoFocus
            aria-label="Note"
            maxLength={500}
            value={draft.text}
            placeholder="What's wrong here?"
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save()
              else if (event.key === "Escape") {
                event.preventDefault()
                setDraft(null)
              }
            }}
            className="w-64 border-transparent bg-foreground text-background shadow-lg placeholder:text-background/50 focus:border-primary"
          />
        </div>
      )}
    </div>
  )
})
