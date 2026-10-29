import { RiArrowDownSLine, RiExternalLinkLine, RiPlugLine, RiShareForwardLine } from "@remixicon/react"
import { useRef, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Menu, MenuDescription, MenuItem, MenuLabel } from "@bugberry/ui/menu"
import type { TrackerItem } from "./more-menu"
import { useReportTrackers } from "./useReportTrackers"
import type { ReportDetail } from "../queries"

/** The green of the "bug" in the wordmark, in place of the primary pink; text and icons in white. */
const LEAF =
  "[--btn-bg:var(--color-leaf)] [--btn-foreground:var(--color-white)] [--btn-icon:var(--color-white)] [--btn-icon-active:var(--color-white)] [--btn-overlay:color-mix(in_oklab,var(--color-black)_10%,var(--color-leaf)_90%)] [--btn-ring:var(--color-leaf)]/20 [--btn-outline:var(--color-leaf)]"

/**
 * Send to tracker, beside Copy link and built like it: a main part and an arrow of its own. However many
 * trackers the project has, both open the same list, where each tracker is a choice: send to it, retry a
 * send, or open the issue a send made.
 */
export function TrackerButtonView({ items, onSend }: { items: TrackerItem[]; onSend(integrationId: string): void }) {
  const [open, setOpen] = useState(false)
  const group = useRef<HTMLDivElement>(null)
  if (items.length === 0) return null
  const choose = (run?: () => void) => () => {
    setOpen(false)
    run?.()
  }

  return (
    <div ref={group} className="inline-flex">
      <Button size="sm" aria-expanded={open} className={`${LEAF} rounded-r-none`} onPress={() => setOpen(true)}>
        <RiPlugLine aria-hidden data-icon="plug" />
        Send to tracker
      </Button>
      <Button
        size="sq-sm"
        aria-label="Choose a tracker"
        aria-expanded={open}
        className={`${LEAF} rounded-l-none border-l-white/25`}
        onPress={() => setOpen(true)}
      >
        <RiArrowDownSLine aria-hidden />
      </Button>
      <Menu
        aria-label="Trackers"
        // Opened by either part, not by a MenuTrigger: focus goes into the list as a trigger's menu does.
        autoFocus="first"
        className="min-w-64"
        popover={{ triggerRef: group, isOpen: open, onOpenChange: setOpen, placement: "bottom end" }}
      >
        {items.map((entry) => (
          <MenuItem
            key={entry.integrationId ?? `earlier-${entry.label}`}
            textValue={entry.label}
            isDisabled={entry.action === "none" || (entry.action === "open" && !entry.href)}
            href={entry.action === "open" && entry.href ? entry.href : undefined}
            target={entry.action === "open" ? "_blank" : undefined}
            rel={entry.action === "open" ? "noreferrer" : undefined}
            onAction={choose(
              (entry.action === "send" || entry.action === "retry") && entry.integrationId ? () => onSend(entry.integrationId as string) : undefined,
            )}
          >
            {entry.action === "open" ? <RiExternalLinkLine aria-hidden /> : <RiShareForwardLine aria-hidden />}
            <MenuLabel>{entry.label}</MenuLabel>
            {entry.note && <MenuDescription>{entry.note}</MenuDescription>}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}

export function TrackerButton({ report }: { report: ReportDetail }) {
  const trackers = useReportTrackers(report)
  return <TrackerButtonView items={trackers.items} onSend={trackers.send} />
}
