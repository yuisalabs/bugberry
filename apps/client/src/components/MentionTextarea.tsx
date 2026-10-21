import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react"
import { Textarea } from "@bugberry/ui/textarea"
import { type Mentionable, mentionLabel, mentionQuery, suggestions } from "../lib/mentions"

interface Props {
  value: string
  onChange(value: string): void
  /** Who can be mentioned: the members of the report's workspace. */
  people: Mentionable[]
  /** The person writing: left out of the suggestions, since mentioning yourself notifies nobody. */
  selfId?: string
  /** The picked person, with the label written after "@" (see mentionLabel). */
  onPick(person: Mentionable & { label: string }): void
  label: string
  placeholder?: string
  /** Starting height in lines; the box grows with what is typed. */
  rows?: number
  className?: string
}

/**
 * A comment box that suggests people while "@word" is typed. Arrow keys move, Enter or Tab picks,
 * Escape closes, a click picks. Picking writes "@Name " (or "@Name (email name) " when two people
 * share the name); the caller turns it into a token on save.
 */
export function MentionTextarea({ value, onChange, people, selfId, onPick, label, placeholder, rows = 3, className }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [caret, setCaret] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  /** Where the mention closed with Escape starts; it stays closed until another "@" is typed. */
  const [dismissed, setDismissed] = useState<number | null>(null)
  const nextCaret = useRef<number | null>(null)

  const typing = caret === null ? null : mentionQuery(value, caret)
  // Labels still look at everyone (two people may share a name); only the list leaves the writer out.
  const others = people.filter((person) => person.id !== selfId)
  const options = typing && typing.start !== dismissed ? suggestions(others, typing.query) : []
  const open = options.length > 0
  const current = Math.min(active, options.length - 1)

  useLayoutEffect(() => {
    if (nextCaret.current === null || !ref.current) return
    ref.current.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  }, [value])

  const track = () => {
    const box = ref.current
    if (box) setCaret(box.selectionStart ?? box.value.length)
  }

  const pick = (person: Mentionable) => {
    if (!typing || caret === null) return
    const label = mentionLabel(person, people)
    const inserted = `@${label} `
    const position = typing.start + inserted.length
    nextCaret.current = position
    setCaret(position)
    onChange(value.slice(0, typing.start) + inserted + value.slice(caret))
    onPick({ ...person, label })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || !typing) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((current + step + options.length) % options.length)
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      const person = options[current]
      if (person) pick(person)
    } else if (event.key === "Escape") {
      event.preventDefault()
      setDismissed(typing.start)
    }
  }

  return (
    <div className="relative">
      {/* Intent's Textarea; the suggestion list below follows the caret, so it stays a plain ARIA listbox. */}
      <Textarea
        ref={ref}
        aria-label={label}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        value={value}
        maxLength={5000}
        rows={rows}
        placeholder={placeholder}
        className={className}
        onChange={(event) => {
          const position = event.target.selectionStart ?? event.target.value.length
          // Escape closes one "@word"; a different (or new) "@" opens the list again.
          if (mentionQuery(event.target.value, position)?.start !== dismissed) setDismissed(null)
          onChange(event.target.value)
          setCaret(position)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") track()
        }}
        onClick={track}
        onBlur={() => setCaret(null)}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className="absolute left-0 z-20 mt-1 w-full max-w-xs overflow-hidden rounded-lg bg-overlay py-1 text-sm text-overlay-foreground shadow-lg ring ring-muted-foreground/20 dark:ring-border"
        >
          {options.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              // mousedown, not click: the box keeps focus and its caret.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(person)
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer flex-col px-3 py-1.5 ${index === current ? "bg-primary-subtle" : ""}`}
            >
              <span className="truncate font-medium text-foreground">{person.name}</span>
              <span className="truncate text-xs text-muted-foreground">{person.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
