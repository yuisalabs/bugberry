import { RiArrowDownSLine } from "@remixicon/react"
import { useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Disclosure, DisclosurePanel, DisclosureTrigger } from "@bugberry/ui/disclosure-group"
import { Link } from "@bugberry/ui/link"
import { formatOffset } from "../../lib/format"
import type { VisitedUrl } from "@bugberry/debugger-view"
import { activeIndex, type Playback } from "../../lib/timeline"
import { safeHttpUrl } from "../../lib/urls"

/**
 * The Info tab's pages, as in Jam: closed it shows one page (where the player is, or where the bug was
 * reported before it plays), open it lists them all with that page marked. A time moves the player there.
 */
export function VisitedUrls({ entries, playback = null }: { entries: VisitedUrl[]; playback?: Playback | null }) {
  const [open, setOpen] = useState(false)
  const playing = activeIndex(
    entries.map((entry) => entry.atMs),
    playback?.currentMs ?? null,
  )
  const current = playing >= 0 ? playing : Math.max(0, entries.findIndex((entry) => entry.bugHere))
  const canOpen = entries.length > 1

  const title = (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
      Visited URLs
      <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{entries.length}</span>
    </span>
  )

  const list = (rows: Array<{ entry: VisitedUrl | undefined; index: number }>) => (
    <ol className="flex flex-col gap-0.5 px-1.5 pb-1.5 text-xs">
      {rows.map(({ entry, index }) => {
        if (!entry) return null
        const href = safeHttpUrl(entry.url)
        const isCurrent = index === current
        return (
          <li
            key={`${entry.atMs}-${index}`}
            aria-current={isCurrent ? "true" : undefined}
            className={`grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2 rounded-md px-2 py-1.5 ${isCurrent ? "bg-background shadow-xs ring-1 ring-border" : ""}`}
          >
            <span className="flex items-center gap-2 font-mono text-muted-foreground">
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${entry.bugHere ? "bg-danger" : isCurrent ? "bg-success" : "bg-muted-foreground/40"}`}
              />
              {playback ? (
                <AriaButton onPress={() => playback.seek(entry.atMs)} className="hover:text-primary hover:underline">
                  {formatOffset(entry.atMs)}
                </AriaButton>
              ) : (
                formatOffset(entry.atMs)
              )}
            </span>
            <span className={`flex min-w-0 items-baseline gap-2 ${open ? "flex-wrap" : ""}`}>
              {href ? (
                <Link
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`min-w-0 text-primary hover:underline ${open ? "break-all" : "truncate"}`}
                >
                  <span title={entry.url}>{entry.url}</span>
                </Link>
              ) : (
                <span className={`min-w-0 ${open ? "break-all" : "truncate"}`}>{entry.url}</span>
              )}
              {entry.bugHere && (
                <span className="shrink-0 rounded-full bg-danger-subtle px-1.5 text-[11px] font-medium text-danger-subtle-foreground">
                  Bug here
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
  const all = entries.map((entry, index) => ({ entry, index }))

  if (!canOpen) {
    return (
      <section className="overflow-hidden rounded-lg border border-border bg-muted/40">
        <h3 className="px-3 py-2">{title}</h3>
        {list(all)}
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-muted/40">
      {/* Closed, the one page shows outside the panel; open, the panel lists them all. */}
      <Disclosure isExpanded={open} onExpandedChange={setOpen} className="rounded-none bg-transparent inset-ring-0">
        <DisclosureTrigger triggerIndicator={false} className="px-3 py-2 hover:bg-muted">
          {title}
          <RiArrowDownSLine aria-hidden className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </DisclosureTrigger>
        {!open && list([{ entry: entries[current], index: current }])}
        <DisclosurePanel className="*:pt-0">{open && list(all)}</DisclosurePanel>
      </Disclosure>
    </section>
  )
}
