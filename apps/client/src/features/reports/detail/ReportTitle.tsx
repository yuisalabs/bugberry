import { useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Input } from "@bugberry/ui/input"

const titleClass = "font-heading text-lg font-semibold tracking-tight text-foreground"

/** The report title; the reporter's teammates click it to rename the report. */
export function ReportTitle({ title, editable, onSave }: { title: string; editable: boolean; onSave(next: string): void }) {
  const [draft, setDraft] = useState<string | null>(null)

  if (!editable) return <h1 className={`${titleClass} break-words`}>{title}</h1>

  if (draft === null) {
    return (
      <h1 className={titleClass}>
        <AriaButton
          onPress={() => setDraft(title)}
          className="-mx-1 w-full cursor-text rounded-md px-1 text-left break-words hover:bg-muted"
        >
          {title}
        </AriaButton>
      </h1>
    )
  }

  const finish = () => {
    const next = draft.trim()
    if (next && next !== title) onSave(next)
    setDraft(null)
  }
  return (
    <Input
      aria-label="Title"
      // biome-ignore lint/a11y/noAutofocus: the person just clicked the title to edit it
      autoFocus
      value={draft}
      maxLength={200}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish()
        if (event.key === "Escape") setDraft(null)
      }}
      className={`${titleClass} -mx-1 rounded-md border-ring bg-background px-1 py-0 sm:px-1 sm:py-0 sm:text-2xl`}
    />
  )
}
