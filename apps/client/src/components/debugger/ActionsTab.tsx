import { memo, useMemo, useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
import { type ActionFilter, actionCounts, actionSentence, matchesActionFilter } from "@bugberry/debugger-view"
import type { ViewAction, ViewEvent } from "@bugberry/debugger-view"
import { type Playback, useActiveRow } from "../../lib/timeline"
import { EventTime } from "./EventTime"
import { ACTIVE_ROW, FOLLOW_STICKY_ATTRIBUTE, OFFSCREEN_ROW, useFollow } from "./useFollow"

const FILTERS: Array<[ActionFilter, string]> = [
  ["all", "All"],
  ["clicks", "Clicks"],
  ["inputs", "Inputs"],
  ["navigation", "Navigation"],
  ["tab", "Tab"],
]

const tag = "ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium"

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
  const follow = useFollow(active)
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
      <ol className="divide-y divide-border/60">
        {actions.map((action, index) => (
          <ActionLine
            key={`${action.t}-${index}`}
            action={action}
            active={index === active}
            base={base}
            onSeek={onSeek}
            rowRef={follow(index)}
          />
        ))}
      </ol>
    </div>
  )
}

/** One action as a sentence; memoized, so a new video position re-renders only the lines it moves between. */
const ActionLine = memo(function ActionLine({
  action,
  active,
  base,
  onSeek,
  rowRef,
}: {
  action: ViewAction
  active: boolean
  base: number | null
  onSeek?: (offsetMs: number) => void
  rowRef(element: HTMLElement | null): void
}) {
  const { parts, masked, frustration } = actionSentence(action)
  return (
    <li
      ref={rowRef}
      aria-current={active ? "true" : undefined}
      className={`flex gap-3 px-3 py-2 text-xs ${OFFSCREEN_ROW} ${active ? ACTIVE_ROW : ""}`}
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
