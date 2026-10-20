/** Whether the report page shows DevTools, and how wide; `width: null` is the default (42% of the page). */
export interface DevtoolsLayout {
  open: boolean
  width: number | null
}

const KEY = "bugberry:devtools"
const MIN_WIDTH = 360
/** The report beside the panel keeps at least this much. */
const REPORT_MIN = 560

/** As this browser last left it; open at the default width when nothing is stored or storage is blocked. */
export function readDevtools(): DevtoolsLayout {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<DevtoolsLayout> | null
    return {
      open: stored?.open !== false,
      width: typeof stored?.width === "number" && Number.isFinite(stored.width) ? stored.width : null,
    }
  } catch {
    return { open: true, width: null }
  }
}

export function saveDevtools(layout: DevtoolsLayout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout))
  } catch {
    // Private windows and blocked storage: the choice lasts until the page reloads.
  }
}

/** The panel's column in the page grid: 42% by default, and a chosen width never crowds the report out. */
export function devtoolsColumn(width: number | null): string {
  return width === null ? "max(420px,42%)" : `min(${width}px, calc(100% - ${REPORT_MIN}px))`
}

/** A width the panel can be dragged to: never narrower than 360 px, never crowding the report out. */
export function clampDevtoolsWidth(width: number, viewport: number): number {
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, viewport - REPORT_MIN)))
}
