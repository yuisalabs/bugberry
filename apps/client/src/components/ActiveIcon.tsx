import type { RemixiconComponentType } from "@remixicon/react"

/** BugBerry's icons are Remix's line variants; the fill variant marks what is on (the open page, a chosen view). */
export function ActiveIcon({
  active,
  line: Line,
  fill: Fill,
  className,
}: {
  active: boolean
  line: RemixiconComponentType
  fill: RemixiconComponentType
  className?: string
}) {
  const Icon = active ? Fill : Line
  return <Icon aria-hidden className={className} />
}
