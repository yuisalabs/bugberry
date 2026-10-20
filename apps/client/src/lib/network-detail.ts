/** How tall the request opened under the Network table starts out. */
export const DEFAULT_DETAIL_HEIGHT = 320

const KEY = "bugberry:network-detail-height"
const MIN_HEIGHT = 120
/** The table above the detail keeps at least this much, so a few rows stay in view. */
const TABLE_MIN = 96

/** A height the detail can be dragged to: never shorter than 120 px, never pushing the table out of view. */
export function clampDetailHeight(height: number, room: number): number {
  return Math.round(Math.min(Math.max(height, MIN_HEIGHT), Math.max(MIN_HEIGHT, room - TABLE_MIN)))
}

/** As this browser last left it; the default when nothing is stored or storage is blocked. */
export function readDetailHeight(): number {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as unknown
    if (typeof stored !== "number" || !Number.isFinite(stored)) return DEFAULT_DETAIL_HEIGHT
    return Math.max(Math.round(stored), MIN_HEIGHT)
  } catch {
    return DEFAULT_DETAIL_HEIGHT
  }
}

export function saveDetailHeight(height: number): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(height))
  } catch {
    // Private windows and blocked storage: the height lasts until the page reloads.
  }
}
