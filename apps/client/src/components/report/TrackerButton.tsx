import { RiArrowDownSLine, RiExternalLinkLine, RiShareForwardLine } from "@remixicon/react"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Menu, MenuDescription, MenuItem, MenuLabel, MenuTrigger } from "@bugberry/ui/menu"
import type { ReportDetail } from "../../lib/api"
import type { TrackerItem } from "../../lib/more-menu"
import { useReportTrackers } from "./useReportTrackers"

/** The green of the "bug" in the wordmark, in place of the primary pink; text and icons in white. */
const LEAF =
  "[--btn-bg:var(--color-leaf)] [--btn-foreground:var(--color-white)] [--btn-icon:var(--color-white)] [--btn-icon-active:var(--color-white)] [--btn-overlay:color-mix(in_oklab,var(--color-black)_10%,var(--color-leaf)_90%)] [--btn-ring:var(--color-leaf)]/20 [--btn-outline:var(--color-leaf)]"

/**
 * Send to tracker, beside Copy link and shaped like it: the main part acts on the project's first tracker
 * (send, retry, or open the issue it made); the arrow, when there are more, lists every tracker.
 */
export function TrackerButtonView({
  primary,
  items,
  onSend,
}: {
  primary: { item: TrackerItem; label: string } | null
  items: TrackerItem[]
  onSend(integrationId: string): void
}) {
  if (!primary) return null
  const { item, label } = primary
  const more = items.length > 1
  const shape = more ? "rounded-r-none" : ""

  const main =
    item.action === "open" && item.href ? (
      <a href={item.href} target="_blank" rel="noreferrer" className={buttonStyles({ size: "sm", className: `${LEAF} ${shape}` })}>
        <RiExternalLinkLine aria-hidden />
        {label}
      </a>
    ) : (
      <Button
        size="sm"
        className={`${LEAF} ${shape}`}
        isDisabled={item.action === "none" || item.action === "open"}
        onPress={() => item.integrationId && (item.action === "send" || item.action === "retry") && onSend(item.integrationId)}
      >
        <RiShareForwardLine aria-hidden />
        {label}
      </Button>
    )

  return (
    <div className="inline-flex">
      {main}
      {more && (
        <MenuTrigger>
          <Button size="sq-sm" aria-label="Other trackers" className={`${LEAF} rounded-l-none border-l-white/25`}>
            <RiArrowDownSLine aria-hidden />
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
                onAction={
                  (entry.action === "send" || entry.action === "retry") && entry.integrationId ? () => onSend(entry.integrationId as string) : undefined
                }
              >
                <MenuLabel>{entry.label}</MenuLabel>
                {entry.note && <MenuDescription>{entry.note}</MenuDescription>}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      )}
    </div>
  )
}

export function TrackerButton({ report }: { report: ReportDetail }) {
  const trackers = useReportTrackers(report)
  return <TrackerButtonView primary={trackers.primary} items={trackers.items} onSend={trackers.send} />
}
