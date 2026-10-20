function startDrag(
  cursor: string,
  start: number,
  at: (event: PointerEvent) => number,
  onMove: (delta: number) => void,
  onEnd?: (delta: number) => void,
) {
  let moved: number | null = null
  const move = (event: PointerEvent) => {
    moved = at(event) - start
    onMove(moved)
  }
  const stop = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
  }
  const end = () => {
    stop()
    if (moved !== null) onEnd?.(moved)
  }
  document.body.style.cursor = cursor
  document.body.style.userSelect = "none"
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", end)
  return stop
}

/**
 * Follows a sideways drag that started at `startX`, telling `onMove` how far the pointer has moved; it ends on
 * pointer up, which tells `onEnd` where it stopped (only when it moved at all). While it lasts the whole page
 * shows the resize cursor and text is not selected. Returns a stop function for a drag cut short (the edge
 * unmounted mid-drag), which does not call `onEnd`.
 */
export function startHorizontalDrag(
  startX: number,
  onMove: (deltaX: number) => void,
  onEnd?: (deltaX: number) => void,
): () => void {
  return startDrag("col-resize", startX, (event) => event.clientX, onMove, onEnd)
}

/** The same for an up-and-down drag that started at `startY`. */
export function startVerticalDrag(
  startY: number,
  onMove: (deltaY: number) => void,
  onEnd?: (deltaY: number) => void,
): () => void {
  return startDrag("row-resize", startY, (event) => event.clientY, onMove, onEnd)
}
