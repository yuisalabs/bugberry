/**
 * Follows a sideways drag that started at `startX`, telling `onMove` how far the pointer has moved; it ends on
 * pointer up. While it lasts the whole page shows the resize cursor and text is not selected. Returns a stop
 * function for a drag cut short (the edge unmounted mid-drag).
 */
export function startHorizontalDrag(startX: number, onMove: (deltaX: number) => void): () => void {
  const move = (event: PointerEvent) => onMove(event.clientX - startX)
  const stop = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", stop)
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
  }
  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", stop)
  return stop
}
