import { useEffect, useRef } from "react"

export const ACTIVE_ROW = "ring-2 ring-inset ring-ring"

/** Marks the panel that follows the playing video; only it scrolls, never the page. */
export const FOLLOW_SCROLL_ATTRIBUTE = "data-follow-scroll"
/** Marks a header that sticks to the top of that panel, so a row hidden under it is scrolled out. */
export const FOLLOW_STICKY_ATTRIBUTE = "data-follow-sticky"

/**
 * Keeps the active row visible inside its scroll panel when it changes, so the list follows the
 * playing video. scrollIntoView is avoided: it also scrolls the page and pushes the video off-screen.
 */
export function useFollow(active: number) {
  const rows = useRef(new Map<number, HTMLElement>())
  useEffect(() => {
    const row = active >= 0 ? rows.current.get(active) : undefined
    const panel = row?.closest<HTMLElement>(`[${FOLLOW_SCROLL_ATTRIBUTE}]`)
    if (!row || !panel) return
    const panelBox = panel.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    const covered = panel.querySelector<HTMLElement>(`[${FOLLOW_STICKY_ATTRIBUTE}]`)?.offsetHeight ?? 0
    const target = nextScrollTop(
      { scrollTop: panel.scrollTop, height: panel.clientHeight, covered },
      { top: rowBox.top - panelBox.top, bottom: rowBox.bottom - panelBox.top },
    )
    if (target !== null) panel.scrollTop = target
  }, [active])
  return (index: number) => (element: HTMLElement | null) => {
    if (element) rows.current.set(index, element)
    else rows.current.delete(index)
  }
}

/**
 * New scrollTop for a scroll panel so that `row` (its top and bottom measured from the panel's top
 * edge) is fully visible, or null when it already is. `covered` is the height of a sticky header at the
 * panel's top: a row under it is hidden too.
 */
export function nextScrollTop(
  panel: { scrollTop: number; height: number; covered?: number },
  row: { top: number; bottom: number },
): number | null {
  const covered = panel.covered ?? 0
  if (row.top < covered) return panel.scrollTop + row.top - covered
  if (row.bottom > panel.height) return panel.scrollTop + (row.bottom - panel.height)
  return null
}
