import { RiFilter3Line } from "@remixicon/react"
import { useEffect, useRef, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Input, InputGroup } from "@bugberry/ui/input"
import { SearchField } from "@bugberry/ui/search-field"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
import type { ViewEvent } from "@bugberry/debugger-view"
import { startHorizontalDrag } from "../../lib/drag"
import { formatDuration } from "../../lib/format"
import {
  formatBytes,
  matchesFilter,
  type NetworkRow,
  networkRows,
  networkTotals,
  requestDomain,
  requestName,
  requestState,
  sizeLabel,
  TYPE_FILTERS,
  type TypeFilter,
  waterfall,
} from "@bugberry/debugger-view"
import {
  clampColumnWidth,
  type ColumnWidths,
  DEFAULT_COLUMN_WIDTHS,
  NETWORK_COLUMNS,
  readColumnWidths,
  type SizedColumn,
  saveColumnWidths,
  WATERFALL_MIN_WIDTH,
} from "../../lib/network-columns"
import { activeRow, type Playback } from "../../lib/timeline"
import { RequestDetail } from "./RequestDetail"
import { ACTIVE_ROW, FOLLOW_SCROLL_ATTRIBUTE, FOLLOW_STICKY_ATTRIBUTE, useFollow } from "./useFollow"

const ROW_STYLES = {
  // Zebra stripes for ordinary rows; failed and canceled ones keep their own colour.
  ok: "text-foreground even:bg-muted-foreground/6 hover:bg-muted-foreground/12",
  failed: "bg-danger-subtle text-danger-subtle-foreground",
  canceled: "bg-warning-subtle text-warning-subtle-foreground",
} as const

const stateOf = (row: NetworkRow) => (row.request ? requestState(row.request) : "ok")

const KEY_STEP = 16

/** Every cell keeps to its column: what does not fit ends in an ellipsis, and a line rules it off from the next, as in Chrome. */
const CELL = "overflow-hidden text-ellipsis whitespace-nowrap border-r border-border/60 px-2 py-1"

/**
 * A column's right edge in the header: it lights up on hover and drags to make the column wider or narrower.
 * Arrow keys move it in steps; a double click goes back to the column's default width.
 */
function ColumnResizer({
  column,
  width,
  onResize,
}: {
  column: SizedColumn
  width: number
  onResize(width: number): void
}) {
  const stopDrag = useRef<() => void>(() => {})
  useEffect(() => () => stopDrag.current(), [])
  return (
    <div
      role="separator"
      aria-label={`Resize ${column} column`}
      aria-orientation="vertical"
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize. Double-click for the default width."
      onPointerDown={(down) => {
        down.preventDefault()
        down.stopPropagation()
        const startWidth = width
        stopDrag.current = startHorizontalDrag(down.clientX, (deltaX) => onResize(startWidth + deltaX))
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") onResize(width + KEY_STEP)
        else if (event.key === "ArrowLeft") onResize(width - KEY_STEP)
        else return
        event.preventDefault()
      }}
      onDoubleClick={() => onResize(DEFAULT_COLUMN_WIDTHS[column])}
      className="group/edge absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize outline-hidden"
    >
      <span className="absolute inset-y-0 right-0 w-0.5 bg-transparent transition-colors group-hover/edge:bg-primary group-focus-visible/edge:bg-primary" />
    </div>
  )
}

/** The recorded requests and page files as a Chrome-like table; a row opens its detail in place of the table. */
export function NetworkTab({
  events,
  base,
  playback = null,
  openKey = null,
  onOpened,
}: {
  events: readonly ViewEvent[]
  base: number | null
  playback?: Playback | null
  /** A row to open from outside (the "BugBerry flagged" box); a new nonce opens it again. */
  openKey?: { key: string; nonce: number } | null
  /** Told once the row asked for has been opened, so it is not opened again on the next visit. */
  onOpened?(nonce: number): void
}) {
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All")
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [widths, setWidths] = useState<ColumnWidths>(readColumnWidths)
  const resize = (column: SizedColumn, width: number) => {
    setWidths((current) => {
      const next = { ...current, [column]: clampColumnWidth(width) }
      saveColumnWidths(next)
      return next
    })
  }
  useEffect(() => {
    if (!openKey) return
    // Filters that would hide the row are cleared, so Back shows it in the full list.
    setErrorsOnly(false)
    setTypeFilter("All")
    setQuery("")
    setOpen(openKey.key)
    onOpened?.(openKey.nonce)
  }, [openKey?.nonce])
  const all = networkRows(events)
  const needle = query.trim().toLowerCase()
  const visible = all.filter(
    (row) =>
      matchesFilter(row, typeFilter) &&
      (!errorsOnly || stateOf(row) !== "ok") &&
      (!needle || row.url.toLowerCase().includes(needle)),
  )
  const active = activeRow(
    visible.map((row) => row.t),
    base,
    playback,
  )
  const follow = useFollow(active)
  const bars = waterfall(all)
  const totals = networkTotals(events)
  const failed = all.filter((row) => stateOf(row) === "failed").length
  const canceled = all.filter((row) => stateOf(row) === "canceled").length
  const opened = open === null ? undefined : all.find((row) => row.key === open)

  if (opened) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RequestDetail row={opened} base={base} playback={playback} onBack={() => setOpen(null)} />
      </div>
    )
  }

  const changed = () => setOpen(null)
  const timings = [
    totals.transferredBytes > 0 ? `${formatBytes(totals.transferredBytes)} transferred` : null,
    totals.resourceBytes > 0 ? `${formatBytes(totals.resourceBytes)} resources` : null,
    totals.finishMs !== null && totals.finishMs > 0 ? `Finish: ${formatDuration(totals.finishMs)}` : null,
    totals.domContentLoadedMs !== null ? `DOMContentLoaded: ${totals.domContentLoadedMs} ms` : null,
    totals.loadMs !== null ? `Load: ${totals.loadMs} ms` : null,
  ].filter((part): part is string => part !== null)

  return (
    // The filters above and the totals below stay put; the table scrolls on its own, under a header that sticks.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            aria-label="Filter requests"
            value={query}
            onChange={(value) => {
              setQuery(value)
              changed()
            }}
            className="min-w-40 flex-1"
          >
            <InputGroup>
              <RiFilter3Line aria-hidden data-slot="icon" />
              <Input placeholder="Filter requests" />
            </InputGroup>
          </SearchField>
          <SwitchField
            isSelected={errorsOnly}
            onChange={(value) => {
              setErrorsOnly(value)
              changed()
            }}
            className="w-auto"
          >
            {/* Label and switch side by side, centred on the search box beside them. */}
            <Switch className="items-center gap-x-2 *:data-[slot=indicator]:mt-0 *:data-[slot=indicator]:self-center sm:*:data-[slot=indicator]:mt-0">
              Errors only
            </Switch>
          </SwitchField>
        </div>
        <ToggleGroup
          aria-label="Request type"
          size="xs"
          disallowEmptySelection
          selectedKeys={[typeFilter]}
          onSelectionChange={(keys) => {
            const [key] = keys
            if (!key) return
            setTypeFilter(key as typeof typeFilter)
            changed()
          }}
          className="flex-wrap self-start"
        >
          {TYPE_FILTERS.map((filter) => (
            <ToggleGroupItem key={filter} id={filter}>
              {filter}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {visible.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{all.length === 0 ? "No requests were recorded." : "No requests match."}</p>
      ) : (
        <div {...{ [FOLLOW_SCROLL_ATTRIBUTE]: "" }} className="min-h-0 flex-1 overflow-auto">
          {/*
            A plain <table>, not Intent's Table: React Aria's grid keeps the arrow keys for moving between cells,
            which takes them from the column edges below, and its own resizer drags, steps and resets differently.
          */}
          <table
            className="w-full table-fixed border-separate border-spacing-0 text-left text-xs"
            style={{ minWidth: Object.values(widths).reduce((sum, width) => sum + width, WATERFALL_MIN_WIDTH) }}
          >
            <colgroup>
              {NETWORK_COLUMNS.map((column) => (
                <col key={column} data-column={column} style={column === "Waterfall" ? undefined : { width: widths[column] }} />
              ))}
            </colgroup>
            <thead {...{ [FOLLOW_STICKY_ATTRIBUTE]: "" }} className="sticky top-0 z-10 bg-background text-muted-foreground">
              <tr>
                {NETWORK_COLUMNS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    // Named on its own: otherwise the resize edge's label becomes part of the header's name.
                    aria-label={column}
                    className={`relative border-b border-b-border font-medium first:pl-3 ${column === "Waterfall" ? "px-2 py-1.5" : `${CELL} py-1.5`}`}
                  >
                    {column}
                    {column !== "Waterfall" && <ColumnResizer column={column} width={widths[column]} onResize={(width) => resize(column, width)} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => {
                const state = stateOf(row)
                const bar = bars.get(row.key)
                return (
                  <tr
                    key={row.key}
                    ref={follow(index)}
                    aria-current={index === active ? "true" : undefined}
                    // The whole row opens the request; the name is a button too, so the keyboard can reach it.
                    onClick={() => setOpen(row.key)}
                    className={`cursor-pointer ${ROW_STYLES[state]} ${row.page ? "font-semibold" : ""} ${index === active ? ACTIVE_ROW : ""} [&>td]:border-b [&>td]:border-b-border/60`}
                  >
                    <td className={`${CELL} pl-3 font-mono text-muted-foreground`}>{index + 1}</td>
                    <td className={CELL}>
                      <AriaButton onPress={() => setOpen(row.key)} className="block w-full cursor-pointer truncate text-left font-medium">
                        <span title={row.url}>{requestName(row.url)}</span>
                      </AriaButton>
                    </td>
                    <td className={`${CELL} font-mono`}>{state === "canceled" ? "(canceled)" : (row.status ?? "")}</td>
                    <td className={`${CELL} font-mono`}>{row.method}</td>
                    <td className={CELL}>{row.type}</td>
                    <td className={`${CELL} text-muted-foreground`}>{sizeLabel(row)}</td>
                    <td className={`${CELL} font-mono`}>{row.durationMs === null ? "" : formatDuration(row.durationMs)}</td>
                    <td className={`${CELL} text-muted-foreground`}>
                      {row.request?.initiator ?? row.resource?.initiatorType ?? (row.page ? row.page.via : "")}
                    </td>
                    <td className={`${CELL} text-muted-foreground`}>{requestDomain(row.url)}</td>
                    <td className="px-2 py-1">
                      {bar && (
                        <div className="relative h-2 rounded bg-muted">
                          <div
                            className={`absolute inset-y-0 rounded ${state === "ok" ? "bg-primary/70" : "bg-danger"}`}
                            style={{ left: `${Math.min(bar.leftPercent, 99.5)}%`, width: `${bar.widthPercent}%` }}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <p>
          {all.length} requests · {failed} failed · {canceled} canceled
        </p>
        {timings.length > 0 && <p>{timings.join(" · ")}</p>}
      </div>
    </div>
  )
}
