export type ReportLayout = "grid" | "list"

const KEY = "bugberry:report-layout"

/** Grid or list, as this browser last chose; grid when nothing is stored or storage is blocked. */
export function readLayout(): ReportLayout {
  try {
    return window.localStorage.getItem(KEY) === "list" ? "list" : "grid"
  } catch {
    return "grid"
  }
}

export function saveLayout(layout: ReportLayout): void {
  try {
    window.localStorage.setItem(KEY, layout)
  } catch {
    // Private windows and blocked storage: the choice lasts until the page reloads.
  }
}
