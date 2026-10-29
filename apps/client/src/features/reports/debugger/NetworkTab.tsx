import { RiFilter3Line } from "@remixicon/react"
import { type CSSProperties, memo, useEffect, useMemo, useRef, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Input, InputGroup } from "@bugberry/ui/input"
import { SearchField } from "@bugberry/ui/search-field"
import { Sheet } from "@bugberry/ui/sheet"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
import type { ViewEvent } from "@bugberry/debugger-view"
import { PHONE_QUERY, useMediaQuery } from "../../../hooks/useMediaQuery"
import { startHorizontalDrag, startVerticalDrag } from "../detail/drag"
import { formatDuration } from "../../../lib/format"
import {
  formatBytes,
  matchesFilter,
  type NetworkRow,
  networkRows,
  networkTotals,
  requestDomain,
  requestName,
  requestPath,
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
  gridColumns,
  NETWORK_COLUMNS,
  readColumnWidths,
  type SizedColumn,
  saveColumnWidths,
  WATERFALL_MIN_WIDTH,
} from "./network-columns"
import { clampDetailHeight, DEFAULT_DETAIL_HEIGHT, readDetailHeight, saveDetailHeight } from "./network-detail"
import { type Playback, useActiveRow } from "./timeline"
import { RequestDetail } from "./RequestDetail"
import { ACTIVE_ROW, FOLLOW_SCROLL_ATTRIBUTE, FOLLOW_STICKY_ATTRIBUTE, useVirtualRows } from "./useVirtualRows"

const ROW_STYLES = {
  ok: "text-foreground hover:bg-muted-foreground/12",
  failed: "bg-danger-subtle text-danger-subtle-foreground",
  canceled: "bg-warning-subtle text-warning-subtle-foreground",
} as const

/** The opened row: a bar down its left edge, and a tint where the row has no colour of its own. */
const SELECTED_STYLES = {
  ok: "bg-primary-subtle text-primary-subtle-foreground shadow-[inset_3px_0_0_var(--color-primary)]",
  failed: `${ROW_STYLES.failed} shadow-[inset_3px_0_0_var(--color-primary)]`,
  canceled: `${ROW_STYLES.canceled} shadow-[inset_3px_0_0_var(--color-primary)]`,
} as const

const stateOf = (row: NetworkRow) => (row.request ? requestState(row.request) : "ok")

const KEY_STEP = 16

/** Every cell keeps to its column: what does not fit ends in an ellipsis, and a line rules it off from the next, as in Chrome. */
const CELL = "overflow-hidden text-ellipsis whitespace-nowrap border-r border-border/60 px-2 py-1"

/** A header or body row: a grid on the table's column template. */
const GRID_ROW = "grid grid-cols-(--network-columns)"

/** Zebra stripes for every other ordinary row; failed, canceled and opened ones keep their own colour. */
const STRIPE = "bg-muted-foreground/6"

/** A body row: one line of text and its cell padding, and the rule under it. */
const ROW_HEIGHT = 25

/** A phone's row: the path over its type and time, in one tap-sized line. */
const PHONE_ROW_HEIGHT = 57

/** The status pill on a phone's row: the row stays plain and the pill carries the colour. */
const PILL_STYLES = {
  ok: "bg-muted text-muted-foreground",
  failed: "bg-danger-subtle text-danger-subtle-foreground",
  canceled: "bg-warning-subtle text-warning-subtle-foreground",
} as const

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

/**
 * The edge between the table and the request opened under it: it drags up to make the detail taller, down to make
 * it shorter. A drag only previews (`onDrag`) and settles once, on release (`onResize`). Arrow keys move it in
 * steps; a double click goes back to the default height.
 */
function DetailResizer({
  height,
  onDrag,
  onResize,
}: {
  height: number
  onDrag(height: number): void
  onResize(height: number): void
}) {
  const stopDrag = useRef<() => void>(() => {})
  useEffect(() => () => stopDrag.current(), [])
  return (
    <div
      role="separator"
      aria-label="Resize request details"
      aria-orientation="horizontal"
      aria-valuenow={height}
      tabIndex={0}
      title="Drag to resize. Double-click for the default height."
      onPointerDown={(down) => {
        down.preventDefault()
        const startHeight = height
        stopDrag.current = startVerticalDrag(
          down.clientY,
          (deltaY) => onDrag(startHeight - deltaY),
          (deltaY) => onResize(startHeight - deltaY),
        )
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") onResize(height + KEY_STEP)
        else if (event.key === "ArrowDown") onResize(height - KEY_STEP)
        else return
        event.preventDefault()
      }}
      onDoubleClick={() => onResize(DEFAULT_DETAIL_HEIGHT)}
      className="group/edge relative z-20 -my-1 h-2 shrink-0 cursor-row-resize outline-hidden"
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border transition-colors group-hover/edge:h-0.5 group-hover/edge:bg-primary group-focus-visible/edge:h-0.5 group-focus-visible/edge:bg-primary" />
    </div>
  )
}

/**
 * The recorded requests and page files as a Chrome-like table; a row opens its detail under the table. On phones
 * the columns give way to one row per request (method, path, time and status) and the detail opens in a sheet.
 */
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
  const [detailHeight, setDetailHeight] = useState(readDetailHeight)
  const phone = useMediaQuery(PHONE_QUERY)
  const split = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  const fitDetail = (height: number) => clampDetailHeight(height, split.current?.clientHeight ?? Number.POSITIVE_INFINITY)
  // While dragging only the detail's box moves: re-rendering the table and a long response body on every pointer
  // move is what made the drag stall. React and storage hear about it once, on release.
  const previewDetail = (height: number) => {
    if (detail.current) detail.current.style.flexBasis = `${fitDetail(height)}px`
  }
  const resizeDetail = (height: number) => {
    const next = fitDetail(height)
    setDetailHeight(next)
    saveDetailHeight(next)
  }
  const resize = (column: SizedColumn, width: number) => {
    setWidths((current) => {
      const next = { ...current, [column]: clampColumnWidth(width) }
      saveColumnWidths(next)
      return next
    })
  }
  useEffect(() => {
    if (!openKey) return
    // Filters that would hide the row are cleared, so it shows in the list above its detail.
    setErrorsOnly(false)
    setTypeFilter("All")
    setQuery("")
    setOpen(openKey.key)
    onOpened?.(openKey.nonce)
  }, [openKey?.nonce])
  // Worked out again only when the events or the filters change, not for each video frame.
  const all = useMemo(() => networkRows(events), [events])
  const needle = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      all.filter(
        (row) =>
          matchesFilter(row, typeFilter) &&
          (!errorsOnly || stateOf(row) !== "ok") &&
          (!needle || row.url.toLowerCase().includes(needle)),
      ),
    [all, typeFilter, errorsOnly, needle],
  )
  const times = useMemo(() => visible.map((row) => row.t), [visible])
  const active = useActiveRow(times, base, playback)
  const keys = useMemo(() => visible.map((row) => row.key), [visible])
  const virtual = useVirtualRows<HTMLTableSectionElement>({ keys, estimate: phone ? PHONE_ROW_HEIGHT : ROW_HEIGHT, active })
  const bars = useMemo(() => waterfall(all), [all])
  const totals = useMemo(() => networkTotals(events), [events])
  const failed = useMemo(() => all.filter((row) => stateOf(row) === "failed").length, [all])
  const canceled = useMemo(() => all.filter((row) => stateOf(row) === "canceled").length, [all])
  const opened = open === null ? undefined : all.find((row) => row.key === open)

  const timings = [
    totals.transferredBytes > 0 ? `${formatBytes(totals.transferredBytes)} transferred` : null,
    totals.resourceBytes > 0 ? `${formatBytes(totals.resourceBytes)} resources` : null,
    totals.finishMs !== null && totals.finishMs > 0 ? `Finish: ${formatDuration(totals.finishMs)}` : null,
    totals.domContentLoadedMs !== null ? `DOMContentLoaded: ${totals.domContentLoadedMs} ms` : null,
    totals.loadMs !== null ? `Load: ${totals.loadMs} ms` : null,
  ].filter((part): part is string => part !== null)

  return (
    // The filters above and the totals below stay put; the table scrolls on its own, under a header that sticks.
    // An opened request shows under the table, as tall as its edge was dragged; the table keeps the rest.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            aria-label="Filter requests"
            value={query}
            onChange={(value) => {
              setQuery(value)
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
      <div ref={split} className="flex min-h-0 flex-1 flex-col">
        {visible.length === 0 ? (
          <p className="min-h-24 flex-1 p-4 text-sm text-muted-foreground">
            {all.length === 0 ? "No requests were recorded." : "No requests match."}
          </p>
        ) : (
          <div {...{ [FOLLOW_SCROLL_ATTRIBUTE]: "" }} className="min-h-24 flex-1 overflow-auto">
            {/*
              A plain <table>, not Intent's Table: React Aria's grid keeps the arrow keys for moving between cells,
              which takes them from the column edges below, and its own resizer drags, steps and resets differently.
              Its rows are grids rather than table rows, so only those in view need be in the page (useVirtualRows);
              the roles and row indexes keep it a table for screen readers.
            */}
            <table
              role="table"
              aria-rowcount={visible.length + (phone ? 0 : 1)}
              className="block text-left text-xs"
              style={
                phone
                  ? undefined
                  : ({
                      minWidth: Object.values(widths).reduce((sum, width) => sum + width, WATERFALL_MIN_WIDTH),
                      "--network-columns": gridColumns(widths),
                    } as CSSProperties)
              }
            >
              {!phone && (
                <thead
                  {...{ [FOLLOW_STICKY_ATTRIBUTE]: "" }}
                  role="rowgroup"
                  className="sticky top-0 z-10 block bg-background text-muted-foreground"
                >
                  <tr role="row" aria-rowindex={1} className={GRID_ROW}>
                    {NETWORK_COLUMNS.map((column) => (
                      <th
                        key={column}
                        scope="col"
                        role="columnheader"
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
              )}
              <tbody ref={virtual.list} role="rowgroup" className="relative block" style={{ height: virtual.height }}>
                {virtual.rows.map(({ index, key, top }) => {
                  const row = visible[index] as NetworkRow
                  return (
                    <RequestRow
                      key={key}
                      row={row}
                      index={index}
                      top={top}
                      bar={bars.get(row.key)}
                      selected={row.key === open}
                      active={index === active}
                      compact={phone}
                      onOpen={setOpen}
                      measure={virtual.measure}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {opened && !phone && (
          <>
            <DetailResizer height={detailHeight} onDrag={previewDetail} onResize={resizeDetail} />
            {/* Shrinks before the table does when the panel gets short, so the table keeps a few rows. */}
            <div ref={detail} className="min-h-0 shrink overflow-y-auto" style={{ flexBasis: detailHeight }}>
              <RequestDetail key={opened.key} row={opened} base={base} playback={playback} onClose={() => setOpen(null)} />
            </div>
          </>
        )}
      </div>
      {phone && (
        <Sheet isOpen={Boolean(opened)} onOpenChange={(isOpen) => !isOpen && setOpen(null)} position="bottom" aria-label="Request details">
          {/*
            One height for every request, so the sheet does not jump as tabs and requests change. The room for the
            handle sits outside the scrolling box: inside it, the body would show above the header that sticks. The
            header takes the sheet's own colour, so it reads as part of the sheet.
          */}
          <div className="flex h-[80dvh] flex-col pt-5 [--detail-bg:var(--color-overlay)]">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {opened && <RequestDetail key={opened.key} row={opened} base={base} playback={playback} onClose={() => setOpen(null)} />}
            </div>
          </div>
        </Sheet>
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

/**
 * One request in the table, placed `top` pixels down the table body; memoized, so a new video position re-renders
 * only the rows it moves between.
 */
const RequestRow = memo(function RequestRow({
  row,
  index,
  top,
  bar,
  selected,
  active,
  onOpen,
  measure,
  compact = false,
}: {
  row: NetworkRow
  index: number
  top: number
  bar: { leftPercent: number; widthPercent: number } | undefined
  selected: boolean
  active: boolean
  onOpen(key: string): void
  measure(element: HTMLElement | null): void
  /** A phone's row: method, path, time and a status pill instead of the table's columns. */
  compact?: boolean
}) {
  const state = stateOf(row)
  if (compact) {
    const details = [row.type, row.durationMs === null ? "" : formatDuration(row.durationMs)].filter(Boolean).join(" · ")
    return (
      <tr
        ref={measure}
        data-index={index}
        role="row"
        aria-rowindex={index + 1}
        aria-current={active ? "true" : undefined}
        data-selected={selected || undefined}
        onClick={() => onOpen(row.key)}
        style={{ transform: `translateY(${top}px)` }}
        className={`absolute inset-x-0 top-0 flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2.5 ${selected ? SELECTED_STYLES.ok : "hover:bg-muted"} ${active ? ACTIVE_ROW : ""}`}
      >
        <td role="cell" className="w-11 shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
          {row.method}
        </td>
        <td role="cell" className="min-w-0 flex-1">
          <AriaButton
            onPress={() => onOpen(row.key)}
            className={`block w-full cursor-pointer truncate text-left font-mono text-[13px] text-foreground ${row.page ? "font-semibold" : ""}`}
          >
            <span title={row.url}>{requestPath(row.url)}</span>
          </AriaButton>
          {details && <span className="block truncate text-xs text-muted-foreground">{details}</span>}
        </td>
        <td role="cell" className="shrink-0">
          {/* Files the page loaded have no status of their own: no pill. */}
          {(state === "canceled" || row.status !== null) && (
            <span className={`rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${PILL_STYLES[state]}`}>
              {state === "canceled" ? "canceled" : row.status}
            </span>
          )}
        </td>
      </tr>
    )
  }
  const stripe = state === "ok" && !selected && index % 2 === 1 ? STRIPE : ""
  return (
    <tr
      ref={measure}
      data-index={index}
      role="row"
      aria-rowindex={index + 2}
      aria-current={active ? "true" : undefined}
      data-selected={selected || undefined}
      // The whole row opens the request; the name is a button too, so the keyboard can reach it.
      onClick={() => onOpen(row.key)}
      style={{ transform: `translateY(${top}px)` }}
      className={`${GRID_ROW} absolute inset-x-0 top-0 cursor-pointer ${selected ? SELECTED_STYLES[state] : ROW_STYLES[state]} ${stripe} ${row.page ? "font-semibold" : ""} ${active ? ACTIVE_ROW : ""} [&>td]:border-b [&>td]:border-b-border/60`}
    >
      <td role="cell" className={`${CELL} pl-3 font-mono text-muted-foreground`}>{index + 1}</td>
      <td role="cell" className={CELL}>
        <AriaButton onPress={() => onOpen(row.key)} className="block w-full cursor-pointer truncate text-left font-medium">
          <span title={row.url}>{requestName(row.url)}</span>
        </AriaButton>
      </td>
      <td role="cell" className={`${CELL} font-mono`}>{state === "canceled" ? "(canceled)" : (row.status ?? "")}</td>
      <td role="cell" className={`${CELL} font-mono`}>{row.method}</td>
      <td role="cell" className={CELL}>{row.type}</td>
      <td role="cell" className={`${CELL} text-muted-foreground`}>{sizeLabel(row)}</td>
      <td role="cell" className={`${CELL} font-mono`}>{row.durationMs === null ? "" : formatDuration(row.durationMs)}</td>
      <td role="cell" className={`${CELL} text-muted-foreground`}>
        {row.request?.initiator ?? row.resource?.initiatorType ?? (row.page ? row.page.via : "")}
      </td>
      <td role="cell" className={`${CELL} text-muted-foreground`}>{requestDomain(row.url)}</td>
      <td role="cell" className="flex items-center px-2 py-1">
        {bar && (
          <div className="relative h-2 w-full rounded bg-muted">
            <div
              className={`absolute inset-y-0 rounded ${state === "ok" ? "bg-primary/70" : "bg-danger"}`}
              style={{ left: `${Math.min(bar.leftPercent, 99.5)}%`, width: `${bar.widthPercent}%` }}
            />
          </div>
        )}
      </td>
    </tr>
  )
})
