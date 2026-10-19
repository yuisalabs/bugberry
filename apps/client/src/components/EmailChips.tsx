import { type KeyboardEvent, useState } from "react"
import { Input } from "@bugberry/ui/input"
import { Tag, TagGroup, TagList } from "@bugberry/ui/tag-group"

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/**
 * Email addresses as removable chips: Enter, a comma or leaving the field turns the typed text into chips.
 * A pasted list is split; anything that is not an email stays in the box to fix.
 */
export function EmailChips({ emails, onChange }: { emails: readonly string[]; onChange(emails: string[]): void }) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)

  /** Adds every address in the text and returns what is left: the parts that are not emails. */
  const commit = (raw: string): string => {
    const parts = raw.split(/[\s,;]+/).filter(Boolean)
    const valid = parts.map((part) => part.toLowerCase()).filter((part) => EMAIL.test(part))
    const rest = parts.filter((part) => !EMAIL.test(part.toLowerCase()))
    const added = [...emails]
    for (const email of valid) if (!added.includes(email)) added.push(email)
    if (added.length !== emails.length) onChange(added)
    setError(rest.length > 0 ? "Not an email address" : null)
    return rest.join(" ")
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      setText(commit(text))
    } else if (event.key === "Backspace" && !text && emails.length > 0) {
      onChange(emails.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/20 *:data-[slot=control]:min-w-32 *:data-[slot=control]:flex-1">
        {emails.length > 0 && (
          <TagGroup aria-label="Emails to invite" onRemove={(keys) => onChange(emails.filter((item) => !keys.has(item)))} className="contents">
            <TagList items={emails.map((email) => ({ email }))} className="contents">
              {({ email }) => (
                <Tag id={email} textValue={email}>
                  {email}
                </Tag>
              )}
            </TagList>
          </TagGroup>
        )}
        <Input
          type="text"
          inputMode="email"
          aria-label="Invite teammates"
          placeholder={emails.length === 0 ? "name@company.com" : "Add email"}
          value={text}
          onChange={(event) => {
            const value = event.target.value
            // A comma or semicolon (typed or pasted) finishes the addresses before it.
            if (/[,;]/.test(value)) return setText(commit(value))
            setText(value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (text.trim()) setText(commit(text))
          }}
          className="border-0 bg-transparent px-0 py-0.5 focus:ring-0 sm:px-0 sm:py-0.5"
        />
      </div>
      {error && <p className="text-xs text-danger-subtle-foreground">{error}</p>}
    </div>
  )
}
