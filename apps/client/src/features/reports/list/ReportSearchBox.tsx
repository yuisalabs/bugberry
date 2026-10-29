import { RiSearchLine } from "@remixicon/react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { Input, InputGroup } from "@bugberry/ui/input"
import { Keyboard } from "@bugberry/ui/keyboard"
import { SearchField } from "@bugberry/ui/search-field"
import { isMacPlatform, searchShortcut } from "./shortcuts"

/** "Search reports" in the page header. Ctrl K (⌘K) focuses it from anywhere on the page. */
export function ReportSearchBox({
  value,
  onSearch,
  mac = isMacPlatform(),
}: {
  value: string | undefined
  onSearch(q: string | undefined): void
  /** ⌘K instead of Ctrl K on the hint. */
  mac?: boolean
}) {
  const [q, setQ] = useState(value ?? "")
  useEffect(() => setQ(value ?? ""), [value])
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Only Ctrl K itself: Ctrl Shift K opens the extension, and Chrome gives the page the key first, so
      // catching it here would keep the extension from ever seeing it.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault()
        box.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSearch(q.trim() || undefined)
  }

  return (
    <form role="search" onSubmit={submit} className="min-w-0 flex-1 sm:flex-none">
      {/* White on the grey page so it stands out, and wide enough for a real query. */}
      <SearchField aria-label="Search reports" value={q} onChange={setQ} className="sm:w-80 lg:w-96">
        <InputGroup className="[--input-gutter-end:--spacing(14)]">
          <RiSearchLine aria-hidden data-slot="icon" />
          <Input ref={box} placeholder="Search reports" className="bg-background" />
          {/* The slot fills the input's height to centre the hint; the small box is drawn around the text only. */}
          <Keyboard className="place-content-center font-sans text-muted-foreground sm:grid lg:grid">
            <span className="rounded border border-border px-1 text-[10px]/4">{searchShortcut(mac)}</span>
          </Keyboard>
        </InputGroup>
      </SearchField>
    </form>
  )
}
