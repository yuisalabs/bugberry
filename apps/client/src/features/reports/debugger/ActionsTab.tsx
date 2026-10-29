import { memo, useMemo, useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
import { type ActionFilter, actionCounts, actionSentence, matchesActionFilter } from "@bugberry/debugger-view"
import type { ViewAction, ViewEvent } from "@bugberry/debugger-view"
import { type Playback, useActiveRow } from "./timeline"
import { EventTime, seekOnRowClick } from "./EventTime"
import { ACTIVE_ROW, FOLLOW_STICKY_ATTRIBUTE, useVirtualRows } from "./useVirtualRows"

const FILTERS: Array<[ActionFilter, string]> = [
  ["all", "All"],
  ["clicks", "Clicks"],
  ["inputs", "Inputs"],
  ["navigation", "Navigation"],
  ["tab", "Tab"],
]

const tag = "ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium"

/** A one-line action: its text and padding, and the rule under it. Longer ones are measured as they are drawn. */
const LINE_HEIGHT = 33

/** What the person did, as sentences, with filter chips that count clicks, inputs, navigations and tab changes. */
export function ActionsTab({
  events,
  base,
  playback = null,
}: {
  events: readonly ViewEvent[]
  base: number | null
  playback?: Playback | null
}) {
  const [filter, setFilter] = useState<ActionFilter>("all")
  // Worked out again only when the events or the filter change, not for each video frame.
  const all = useMemo(() => events.filter((event): event is ViewAction => event.kind === "action"), [events])
  const actions = useMemo(() => all.filter((action) => matchesActionFilter(action, filter)), [all, filter])
  const counts = useMemo(() => actionCounts(all), [all])
  const times = useMemo(() => actions.map((action) => action.t), [actions])
  const active = useActiveRow(times, base, playback)
  // Several actions can share a millisecond; the place in the whole recording tells them apart, however filtered.
  const keys = useMemo(() => {
    const place = new Map(all.map((action, index) => [action, index]))
    return actions.map((action) => `${action.t}-${place.get(action)}`)
  }, [actions, all])
  const virtual = useVirtualRows<HTMLOListElement>({ keys, estimate: LINE_HEIGHT, active })
  const onSeek = playback?.seek
  if (all.length === 0) return <p className="p-4 text-sm text-muted-foreground">No actions were recorded.</p>
  return (
    <div className="flex flex-col">
      {/* The filters stay at the top of the panel; only the actions below scroll. */}
      <div {...{ [FOLLOW_STICKY_ATTRIBUTE]: "" }} className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2">
        <ToggleGroup
          aria-label="Action type"
          size="xs"
          disallowEmptySelection
          selectedKeys={[filter]}
          onSelectionChange={(keys) => {
            const [key] = keys
            if (key) setFilter(key as ActionFilter)
          }}
          className="flex-wrap"
        >
          {FILTERS.map(([id, label]) => (
            <ToggleGroupItem key={id} id={id}>
              {label} {counts[id]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {/* Only the actions near the view are in the page (useVirtualRows); each says where it sits in the list. */}
      <ol ref={virtual.list} className="relative" style={{ height: virtual.height }}>
        {virtual.rows.map(({ index, key, top }) => (
          <ActionLine
            key={key}
            action={actions[index] as ViewAction}
            index={index}
            count={actions.length}
            top={top}
            active={index === active}
            base={base}
            onSeek={onSeek}
            measure={virtual.measure}
          />
        ))}
      </ol>
    </div>
  )
}

/**
 * One action as a sentence, placed `top` pixels down the list; memoized, so a new video position re-renders only
 * the lines it moves between.
 */
const ActionLine = memo(function ActionLine({
  action,
  index,
  count,
  top,
  active,
  base,
  onSeek,
  measure,
}: {
  action: ViewAction
  index: number
  count: number
  top: number
  active: boolean
  base: number | null
  onSeek?: (offsetMs: number) => void
  measure(element: HTMLElement | null): void
}) {
  const { parts, masked, frustration } = actionSentence(action)
  const seek = seekOnRowClick(action.t, base, onSeek)
  return (
    <li
      ref={measure}
      data-index={index}
      aria-posinset={index + 1}
      aria-setsize={count}
      aria-current={active ? "true" : undefined}
      onClick={seek}
      style={{ transform: `translateY(${top}px)` }}
      className={`absolute inset-x-0 top-0 flex gap-3 border-b border-border/60 px-3 py-2 text-xs ${seek ? "cursor-pointer hover:bg-muted-foreground/8" : ""} ${active ? ACTIVE_ROW : ""}`}
    >
      <EventTime t={action.t} base={base} onSeek={onSeek} />
      <p className="min-w-0 flex-1 break-words text-foreground">
        {parts.before}
        {parts.target && (
          <>
            {" "}
            <span className="break-all font-mono text-muted-foreground">{parts.target}</span>
          </>
        )}
        {parts.after && ` ${parts.after}`}
        {masked && (
          <>
            {" "}
            <span className={`${tag} bg-muted text-muted-foreground`}>Masked</span>
          </>
        )}
        {frustration && (
          <>
            {" "}
            <span className={`${tag} bg-danger-subtle text-danger-subtle-foreground`}>Frustration signal</span>
          </>
        )}
      </p>
    </li>
  )
})
