import type { ConsoleLevel } from "@bugberry/capture"
import { RiAlertLine, RiCloseCircleLine, RiCursorLine, RiExternalLinkLine, RiFilter3Line } from "@remixicon/react"
import { type ReactNode, useState } from "react"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Disclosure, DisclosurePanel, DisclosureTrigger } from "@bugberry/ui/disclosure-group"
import { Input, InputGroup } from "@bugberry/ui/input"
import { SearchField } from "@bugberry/ui/search-field"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { type ConsoleOptions, type ConsoleRow, consoleCounts, consoleRows, navigationText } from "@bugberry/debugger-view"
import type { ViewEvent } from "@bugberry/debugger-view"
import { activeRow, type Playback } from "../../lib/timeline"
import { EventTime } from "./EventTime"
import { ACTIVE_ROW, FOLLOW_STICKY_ATTRIBUTE, useFollow } from "./useFollow"

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
  const rows = consoleRows(events, options, recording)
  const counts = consoleCounts(events)
  const active = activeRow(
    rows.map((row) => row.t),
    base,
    playback,
  )
  const follow = useFollow(active)
  const empty = consoleRows(events, { ...options, level: "all", query: "" }).length === 0

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
        <ol className="divide-y divide-border/60 font-mono text-xs">
          {rows.map((row, index) => (
            <li
              key={`${row.t}-${row.kind}-${index}`}
              ref={follow(index)}
              aria-current={index === active ? "true" : undefined}
              className={`flex gap-2 px-3 py-1.5 ${rowStyle(row)} ${index === active ? ACTIVE_ROW : ""}`}
            >
              <EventTime t={row.t} base={base} onSeek={playback?.seek} />
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
          ))}
        </ol>
      )}
    </div>
  )
}
