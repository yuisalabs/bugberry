import { measureElement, observeElementRect, useVirtualizer } from "@tanstack/react-virtual"
import { type Key, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

export const ACTIVE_ROW = "ring-2 ring-inset ring-ring"

/** Marks the panel a list scrolls in, and that follows the playing video; only it scrolls, never the page. */
export const FOLLOW_SCROLL_ATTRIBUTE = "data-follow-scroll"
/** Marks a header that sticks to the top of that panel, so a row hidden under it is scrolled out. */
export const FOLLOW_STICKY_ATTRIBUTE = "data-follow-sticky"

/** Rows drawn beyond the visible ones on each side: enough to scroll without a blank edge. */
const OVERSCAN = 12

/**
 * The panel's height while it has none of its own (not laid out yet, or a test page without layout): the first
 * rows are drawn as if it were this tall, rather than none at all.
 */
const UNSIZED_HEIGHT = 800

/** How far down the page an element's layout box starts; unlike its on-screen box, scrolling does not move it. */
function layoutTop(element: HTMLElement): number {
  let top = 0
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop
  return top
}

/**
 * A long list that only has the rows in view (plus a few) in the page, so opening a tab, filtering it or resizing
 * the panel costs the same for a report with 5,000 events as for one with 50. The list scrolls in the nearest
 * `FOLLOW_SCROLL_ATTRIBUTE` panel; whatever sits above it there (filters, a sticky header) is allowed for.
 *
 * Rows are measured as they are drawn, so they may be any height; `estimate` is a one-line row. While a video plays,
 * the `active` row is kept in view under the panel's sticky header.
 */
export function useVirtualRows<TList extends HTMLElement>({
  keys,
  estimate,
  active,
}: {
  /** One per row, in order, and the same for a row however the list is filtered (pass a memoized array). */
  keys: readonly Key[]
  estimate: number
  active: number
}) {
  const count = keys.length
  const list = useRef<TList>(null)
  // Where the list starts inside its panel, and how much of the panel's top a sticky header covers.
  const [frame, setFrame] = useState({ margin: 0, covered: 0 })
  const panel = () => list.current?.closest<HTMLElement>(`[${FOLLOW_SCROLL_ATTRIBUTE}]`) ?? null

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: panel,
    initialRect: { width: 0, height: UNSIZED_HEIGHT },
    observeElementRect: (instance, report) =>
      observeElementRect(instance, (rect) => report(rect.height > 0 ? rect : { ...rect, height: UNSIZED_HEIGHT })),
    // Likewise a row measured at 0 has not been laid out; it keeps the estimate.
    measureElement: (element, entry, instance) => measureElement(element, entry, instance) || estimate,
    estimateSize: () => estimate,
    getItemKey: useCallback((index: number) => keys[index] ?? index, [keys]),
    overscan: OVERSCAN,
    scrollMargin: frame.margin,
    scrollPaddingStart: frame.covered,
  })

  // Filters above the list may wrap onto another line as the panel narrows; read the frame after each render.
  useLayoutEffect(() => {
    const scroller = panel()
    if (!list.current || !scroller) return
    const margin = Math.round(layoutTop(list.current) - layoutTop(scroller) - scroller.clientTop)
    const covered = scroller.querySelector<HTMLElement>(`[${FOLLOW_STICKY_ATTRIBUTE}]`)?.offsetHeight ?? 0
    setFrame((current) => (current.margin === margin && current.covered === covered ? current : { margin, covered }))
  })

  useEffect(() => {
    if (active >= 0 && active < count) virtualizer.scrollToIndex(active, { align: "auto" })
  }, [active])

  return {
    /** Goes on the element that holds the rows; it takes `height` and positions them. */
    list,
    height: virtualizer.getTotalSize(),
    rows: virtualizer.getVirtualItems().map((row) => ({ index: row.index, key: row.key, top: row.start - frame.margin })),
    /** Goes on each row (with `data-index`), so its real height replaces the estimate. */
    measure: virtualizer.measureElement,
  }
}
