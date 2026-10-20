import type { ConsoleLevel } from "@bugberry/capture"
import { RiAlertLine, RiCloseCircleLine, RiCursorLine, RiExternalLinkLine, RiFilter3Line } from "@remixicon/react"
import { memo, type ReactNode, useMemo, useState } from "react"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Disclosure, DisclosurePanel, DisclosureTrigger } from "@bugberry/ui/disclosure-group"
import { Input, InputGroup } from "@bugberry/ui/input"
import { SearchField } from "@bugberry/ui/search-field"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { type ConsoleOptions, type ConsoleRow, consoleCounts, consoleRows, navigationText } from "@bugberry/debugger-view"
import type { ViewEvent } from "@bugberry/debugger-view"
import { type Playback, useActiveRow } from "../../lib/timeline"
import { EventTime, seekOnRowClick } from "./EventTime"
import { ACTIVE_ROW, FOLLOW_STICKY_ATTRIBUTE, useVirtualRows } from "./useVirtualRows"

const LEVEL_OPTIONS: Array<[ConsoleOptions["level"], string]> = [
  ["all", "All levels"],
  ["error", "Errors"],
  ["warn", "Warnings"],
  ["info", "Info"],
  ["log", "Logs"],
  ["debug", "Debug"],
]

const LEVEL_STYLES: Record<ConsoleLevel, string> = {
  log: "text-foreground",
  info: "text-foreground",
  warn: "bg-warning-subtle text-warning-subtle-foreground",
  error: "bg-danger-subtle text-danger-subtle-foreground",
  debug: "text-muted-foreground",
}

/** A one-line row: its text and padding, and the rule under it. Longer ones are measured as they are drawn. */
const LINE_HEIGHT = 29

function rowStyle(row: ConsoleRow): string {
  if (row.kind === "log") return LEVEL_STYLES[row.level]
  if (row.kind === "network-error") return "bg-danger-subtle text-danger-subtle-foreground"
  if (row.kind === "marker") return "font-sans font-medium text-muted-foreground"
  return "text-muted-foreground"
}

function RowIcon({ row }: { row: ConsoleRow }): ReactNode {
  const className = "mt-0.5 size-3.5 shrink-0"
  if (row.kind === "navigation") return <RiExternalLinkLine aria-hidden className={className} />
  if (row.kind === "activity") return <RiCursorLine aria-hidden className={className} />
  if (row.kind === "network-error" || (row.kind === "log" && row.level === "error")) {
    return <RiCloseCircleLine aria-hidden className={className} />
  }
  if (row.kind === "log" && row.level === "warn") return <RiAlertLine aria-hidden className={className} />
  return <span aria-hidden className="w-3.5 shrink-0" />
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(next: boolean): void }) {
  return (
    <CheckboxField isSelected={checked} onChange={onChange}>
      <Checkbox>{label}</Checkbox>
    </CheckboxField>
  )
}


/** Console logs and page errors, with navigations, failed requests and (optionally) clicks in one timeline. */
export function ConsoleTab({
  events,
  base,
  playback = null,
  recording,
}: {
  events: readonly ViewEvent[]
  base: number | null
  playback?: Playback | null
  /** A video's start and length, for the "Recording started/stopped" rows. */
  recording?: { startedAt: number; durationMs: number | null }
}) {
  const [options, setOptions] = useState<ConsoleOptions>({
    level: "all",
    query: "",
    navigations: true,
    networkErrors: true,
    activity: false,
  })
  const set = (patch: Partial<ConsoleOptions>) => setOptions((current) => ({ ...current, ...patch }))
  // Worked out again only when the events, the filters or the recording change, not for each video frame.
  const startedAt = recording?.startedAt
  const durationMs = recording?.durationMs
  const rows = useMemo(
    () => consoleRows(events, options, startedAt === undefined ? undefined : { startedAt, durationMs: durationMs ?? null }),
    [events, options, startedAt, durationMs],
  )
  const counts = useMemo(() => consoleCounts(events), [events])
  const times = useMemo(() => rows.map((row) => row.t), [rows])
  const active = useActiveRow(times, base, playback)
  const keys = useMemo(() => rows.map((row) => row.key), [rows])
  const virtual = useVirtualRows<HTMLOListElement>({ keys, estimate: LINE_HEIGHT, active })
  const empty = useMemo(() => consoleRows(events, { ...options, level: "all", query: "" }).length === 0, [events, options])
  const onSeek = playback?.seek

  return (
    <div className="flex flex-col">
      {/* The filters stay at the top of the panel; only the logs below scroll. */}
      <div {...{ [FOLLOW_STICKY_ATTRIBUTE]: "" }} className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-background px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField aria-label="Filter logs" value={options.query} onChange={(query) => set({ query })} className="min-w-40 flex-1">
            <InputGroup>
              <RiFilter3Line aria-hidden data-slot="icon" />
              <Input placeholder="Filter logs" />
            </InputGroup>
          </SearchField>
          <Select
            aria-label="Level"
            selectedKey={options.level}
            onSelectionChange={(level) => level && set({ level: level as ConsoleOptions["level"] })}
            className="w-auto"
          >
            <SelectTrigger />
            <SelectContent>
              {LEVEL_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} id={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <Toggle label="Page navigations" checked={options.navigations} onChange={(navigations) => set({ navigations })} />
          <Toggle label="Network errors" checked={options.networkErrors} onChange={(networkErrors) => set({ networkErrors })} />
          <Toggle label="User activity" checked={options.activity} onChange={(activity) => set({ activity })} />
        </div>
        <p className="flex gap-3 text-muted-foreground">
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-1.5 rounded-full bg-danger" />
            {counts.errors} errors
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-1.5 rounded-full bg-warning" />
            {counts.warnings} warnings
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />
            {counts.info} info
          </span>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{empty ? "No console logs." : "No logs match."}</p>
      ) : (
        // Only the lines near the view are in the page (useVirtualRows); each says where it sits in the whole list.
        <ol ref={virtual.list} className="relative font-mono text-xs" style={{ height: virtual.height }}>
          {virtual.rows.map(({ index, key, top }) => (
            <ConsoleLine
              key={key}
              row={rows[index] as ConsoleRow}
              index={index}
              count={rows.length}
              top={top}
              active={index === active}
              base={base}
              onSeek={onSeek}
              measure={virtual.measure}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * One line of the console, placed `top` pixels down the list; memoized, so a new video position re-renders only
 * the lines it moves between.
 */
const ConsoleLine = memo(function ConsoleLine({
  row,
  index,
  count,
  top,
  active,
  base,
  onSeek,
  measure,
}: {
  row: ConsoleRow
  index: number
  count: number
  top: number
  active: boolean
  base: number | null
  onSeek?: (offsetMs: number) => void
  measure(element: HTMLElement | null): void
}) {
  const style = rowStyle(row)
  const seek = seekOnRowClick(row.t, base, onSeek)
  // Warnings and errors keep their own colour on hover; plain lines lighten like the Network table's rows.
  const hover = style.includes("bg-") ? "" : "hover:bg-muted-foreground/8"
  return (
    <li
      ref={measure}
      data-index={index}
      aria-posinset={index + 1}
      aria-setsize={count}
      aria-current={active ? "true" : undefined}
      onClick={seek}
      style={{ transform: `translateY(${top}px)` }}
      className={`absolute inset-x-0 top-0 flex gap-2 border-b border-border/60 px-3 py-1.5 ${style} ${seek ? `cursor-pointer ${hover}` : ""} ${active ? ACTIVE_ROW : ""}`}
    >
      <EventTime t={row.t} base={base} onSeek={onSeek} />
      <RowIcon row={row} />
      <div className="min-w-0 flex-1">
        {row.kind === "log" ? (
          <>
            <p className="flex gap-2">
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {row.uncaught && <span className="mr-1 font-semibold">Uncaught</span>}
                {row.text}
              </span>
              {row.source && <span className="shrink-0 text-muted-foreground">{row.source}</span>}
            </p>
            {row.stack && (
              <Disclosure className="rounded-none bg-transparent inset-ring-0">
                <DisclosureTrigger className="w-auto justify-start gap-1 text-xs font-normal opacity-70 [&_[data-slot=disclosure-indicator]]:ms-0">
                  Stack
                </DisclosureTrigger>
                <DisclosurePanel className="*:pt-1 *:text-current">
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs opacity-80">{row.stack}</pre>
                </DisclosurePanel>
              </Disclosure>
            )}
          </>
        ) : (
          <p className="break-all">{row.kind === "navigation" ? navigationText(row) : row.text}</p>
        )}
      </div>
    </li>
  )
})
