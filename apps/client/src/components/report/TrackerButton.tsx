import { RiArrowDownSLine, RiExternalLinkLine, RiShareForwardLine } from "@remixicon/react"
import { Button } from "@bugberry/ui/button"
import { Menu, MenuDescription, MenuItem, MenuLabel, MenuTrigger } from "@bugberry/ui/menu"
import type { ReportDetail } from "../../lib/api"
import type { TrackerItem } from "../../lib/more-menu"
import { useReportTrackers } from "./useReportTrackers"

/** The green of the "bug" in the wordmark, in place of the primary pink; text and icons in white. */
const LEAF =
  "[--btn-bg:var(--color-leaf)] [--btn-foreground:var(--color-white)] [--btn-icon:var(--color-white)] [--btn-icon-active:var(--color-white)] [--btn-overlay:color-mix(in_oklab,var(--color-black)_10%,var(--color-leaf)_90%)] [--btn-ring:var(--color-leaf)]/20 [--btn-outline:var(--color-leaf)]"

/**
 * Send to tracker, beside Copy link: one green button, however many trackers the project has. The trackers
 * are the choices inside it: send to one, retry a send, or open the issue a send made.
 */
export function TrackerButtonView({ items, onSend }: { items: TrackerItem[]; onSend(integrationId: string): void }) {
  if (items.length === 0) return null
  return (
    <MenuTrigger>
      {/* Shaped like Copy link, the arrow split off by a line; the whole button opens the trackers. */}
      <Button size="sm" className={`${LEAF} pr-0`}>
        <RiShareForwardLine aria-hidden />
        Send to tracker
        <span
          data-slot="split-arrow"
          className="ml-1.5 -my-[calc(--spacing(1.5)-1px)] flex items-center self-stretch border-l border-white/25 px-2"
        >
          <RiArrowDownSLine aria-hidden className="size-4 text-white" />
        </span>
      </Button>
      <Menu placement="bottom end" className="min-w-64">
        {items.map((entry) => (
          <MenuItem
            key={entry.integrationId ?? `earlier-${entry.label}`}
            textValue={entry.label}
            isDisabled={entry.action === "none" || (entry.action === "open" && !entry.href)}
            href={entry.action === "open" && entry.href ? entry.href : undefined}
            target={entry.action === "open" ? "_blank" : undefined}
            rel={entry.action === "open" ? "noreferrer" : undefined}
            onAction={(entry.action === "send" || entry.action === "retry") && entry.integrationId ? () => onSend(entry.integrationId as string) : undefined}
          >
            {entry.action === "open" ? <RiExternalLinkLine aria-hidden /> : <RiShareForwardLine aria-hidden />}
            <MenuLabel>{entry.label}</MenuLabel>
            {entry.note && <MenuDescription>{entry.note}</MenuDescription>}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  )
}

export function TrackerButton({ report }: { report: ReportDetail }) {
  const trackers = useReportTrackers(report)
  return <TrackerButtonView items={trackers.items} onSend={trackers.send} />
}
