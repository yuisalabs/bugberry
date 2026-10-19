/** The Network table's columns, left to right. The last one, Waterfall, takes whatever room is left. */
export const NETWORK_COLUMNS = ["#", "Name", "Status", "Method", "Type", "Size", "Time", "Initiator", "Domain", "Waterfall"] as const
export type NetworkColumn = (typeof NETWORK_COLUMNS)[number]
export type SizedColumn = Exclude<NetworkColumn, "Waterfall">
export type ColumnWidths = Record<SizedColumn, number>

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  "#": 44,
  Name: 200,
  Status: 64,
  Method: 64,
  Type: 72,
  Size: 96,
  Time: 72,
  Initiator: 112,
  Domain: 144,
}

/** The waterfall keeps at least this much before the table starts scrolling sideways. */
export const WATERFALL_MIN_WIDTH = 120

const KEY = "bugberry:network-columns"
const MIN_WIDTH = 40

/** A width a column can be dragged to: whole pixels, never narrower than 40. */
export function clampColumnWidth(width: number): number {
  return Math.round(Math.max(width, MIN_WIDTH))
}

/** As this browser last left them; a missing or damaged entry keeps its default. */
export function readColumnWidths(): ColumnWidths {
  const widths = { ...DEFAULT_COLUMN_WIDTHS }
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Record<string, unknown> | null
    for (const column of Object.keys(widths) as SizedColumn[]) {
      const value = stored?.[column]
      if (typeof value === "number" && Number.isFinite(value)) widths[column] = clampColumnWidth(value)
    }
  } catch {
    // A damaged value or blocked storage: the defaults.
  }
  return widths
}

export function saveColumnWidths(widths: ColumnWidths): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(widths))
  } catch {
    // Private windows and blocked storage: the widths last until the page reloads.
  }
}
