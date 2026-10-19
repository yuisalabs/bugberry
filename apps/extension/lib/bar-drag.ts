/** What the bar's frame tells the page layer while the bar is dragged: how far it has moved so far. */
export type BarDragMessage =
  | { bugberry: "bar-drag"; phase: "start" }
  | { bugberry: "bar-drag"; phase: "move" | "end"; dx: number; dy: number }

/** Presses on these keep their own meaning; anywhere else on the bar starts a drag. */
const INTERACTIVE = "button, a, input, textarea, select, [role=button], [role=menuitem]"

export interface BarDragDeps {
  post(message: BarDragMessage): void
  /** One update per painted frame; tests run it at once. */
  requestFrame?(run: () => void): number
  cancelFrame?(id: number): void
}

/**
 * Starts dragging the Recording Bar from a press on `surface`, unless the press is on a button. The pointer
 * is captured, so the drag keeps going when it leaves the bar's frame, and the moves are measured on the
 * screen, which stays still while the frame itself moves. The page layer moves the frame, at most once per
 * painted frame. Returns whether a drag started.
 */
export function startBarDrag(down: PointerEvent, surface: Element, deps: BarDragDeps): boolean {
  if (down.button !== 0 || !(down.target instanceof Element) || down.target.closest(INTERACTIVE)) return false
  down.preventDefault()
  try {
    surface.setPointerCapture(down.pointerId)
  } catch {
    // No pointer to capture (a synthetic event): the moves still arrive while over the bar.
  }
  const requestFrame = deps.requestFrame ?? ((run) => requestAnimationFrame(run))
  const cancelFrame = deps.cancelFrame ?? ((id) => cancelAnimationFrame(id))
  const offset = (event: PointerEvent) => ({ dx: event.screenX - down.screenX, dy: event.screenY - down.screenY })

  let latest = { dx: 0, dy: 0 }
  let pending: number | null = null
  const onMove = (move: Event) => {
    latest = offset(move as PointerEvent)
    if (pending !== null) return
    pending = requestFrame(() => {
      pending = null
      deps.post({ bugberry: "bar-drag", phase: "move", ...latest })
    })
  }
  const onEnd = (end: Event) => {
    if (pending !== null) cancelFrame(pending)
    pending = null
    surface.removeEventListener("pointermove", onMove)
    surface.removeEventListener("pointerup", onEnd)
    surface.removeEventListener("pointercancel", onEnd)
    deps.post({ bugberry: "bar-drag", phase: "end", ...(end.type === "pointerup" ? offset(end as PointerEvent) : latest) })
  }
  surface.addEventListener("pointermove", onMove)
  surface.addEventListener("pointerup", onEnd)
  surface.addEventListener("pointercancel", onEnd)
  deps.post({ bugberry: "bar-drag", phase: "start" })
  return true
}
