import { RiArrowRightSLine } from "@remixicon/react"
import { useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { customFieldNotes, hasFieldTree, type JsonValue, type ViewCustomFields } from "@bugberry/debugger-view"
import { CopyButton } from "../../../components/ui/copy-button"
import { Section } from "./InfoSection"

/** Objects and arrays this deep start closed, so a large store doesn't fill the tab. */
const OPEN_BELOW_DEPTH = 2

function Leaf({ value }: { value: Exclude<JsonValue, object> | null }) {
  if (typeof value === "string") {
    return (
      <span className="break-all text-success-subtle-foreground">
        &quot;<span>{value}</span>&quot;
      </span>
    )
  }
  return <span className="text-primary-subtle-foreground">{String(value)}</span>
}

function Node({ name, value, depth }: { name: string; value: JsonValue; depth: number }) {
  const [open, setOpen] = useState(depth < OPEN_BELOW_DEPTH)
  if (value === null || typeof value !== "object") {
    return (
      <li className="flex gap-1.5">
        <span className="text-muted-foreground">
          <span>{name}</span>:
        </span>
        <Leaf value={value} />
      </li>
    )
  }
  const entries: Array<[string, JsonValue]> = Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value)
  const size = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`
  return (
    <li>
      <AriaButton
        onPress={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RiArrowRightSLine aria-hidden className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="text-foreground">{name}</span>
        <span className="text-muted-foreground">{size}</span>
      </AriaButton>
      {/* Rendered only when open: a closed node's values are not in the page at all. */}
      {open && <Tree entries={entries} depth={depth + 1} />}
    </li>
  )
}

function Tree({ entries, depth }: { entries: Array<[string, JsonValue]>; depth: number }) {
  return (
    <ul className={`flex flex-col gap-0.5 ${depth > 0 ? "ml-4 border-l border-border pl-2" : ""}`}>
      {entries.map(([name, value]) => (
        <Node key={name} name={name} value={value} depth={depth} />
      ))}
    </ul>
  )
}

/** The app's own state from @bugberry/sdk, as a tree of text, with what was left out underneath. */
export function CustomFields({ fields }: { fields: ViewCustomFields }) {
  const notes = customFieldNotes(fields)
  return (
    <Section title="Custom fields">
      {fields.fields && hasFieldTree(fields) && (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-xs">
            <Tree entries={Object.entries(fields.fields)} depth={0} />
          </div>
          <CopyButton text={JSON.stringify(fields.fields, null, 2)} label="Copy JSON" className="self-start" />
        </div>
      )}
      {notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </Section>
  )
}
