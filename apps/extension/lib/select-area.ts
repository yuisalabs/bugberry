/** A box in CSS pixels of the viewport. */
export interface AreaRect {
  x: number
  y: number
  width: number
  height: number
}

export type AreaPick = { kind: "area"; rect: AreaRect; pixelRatio: number } | { kind: "visible" } | { kind: "cancel" }

/** A shorter drag counts as a click, which takes the whole visible area. */
export const MIN_DRAG_PX = 4

/**
 * Runs in the page (scripting.executeScript), so it must be self-contained: no imports, no outer names.
 * Dims the page and lets the reporter drag a box. The overlay is removed, and two frames are painted,
 * before the answer comes back, so it is never in the screenshot.
 */
export function pickArea(): Promise<AreaPick> {
  const minDrag = 4 // MIN_DRAG_PX
  return new Promise((resolve) => {
    // One overlay at a time, until its answer is back: pressing the shortcut twice must not give two
    // screenshots. Kept on the extension's own (isolated) window, so a page can't fake it.
    const busy = window as unknown as { bugberryPicking?: boolean }
    if (busy.bugberryPicking) return resolve({ kind: "cancel" })
    busy.bugberryPicking = true
    const host = document.createElement("div")
    host.setAttribute("data-bugberry-area", "")
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none"
    const root = host.attachShadow({ mode: "closed" })
    const shade = document.createElement("div")
    shade.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.4)"
    const box = document.createElement("div")
    // The huge shadow dims everything outside the box, so the chosen part shows at full brightness.
    box.style.cssText =
      "position:fixed;display:none;border:2px solid #d6246e;box-shadow:0 0 0 100vmax rgba(0,0,0,0.4);box-sizing:border-box"
    // The box's size, next to the cursor, so the reporter sees how big the screenshot will be.
    const size = document.createElement("div")
    size.style.cssText =
      "position:fixed;display:none;padding:3px 8px;border-radius:6px;background:rgba(17,12,20,0.88);color:#fff;font:600 12px/1.4 system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.3)"
    root.append(shade, box, size)
    document.documentElement.append(host)

    let start: { x: number; y: number } | null = null
    const rectTo = (x: number, y: number) => ({
      x: Math.min(start?.x ?? x, x),
      y: Math.min(start?.y ?? y, y),
      width: Math.abs(x - (start?.x ?? x)),
      height: Math.abs(y - (start?.y ?? y)),
    })
    const swallow = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onDown = (event: MouseEvent) => {
      swallow(event)
      // Only the left button drags; a right click must not start a box.
      if (event.button === 0) start = { x: event.clientX, y: event.clientY }
    }
    const onMove = (event: MouseEvent) => {
      swallow(event)
      if (!start) return
      const rect = rectTo(event.clientX, event.clientY)
      shade.style.display = "none"
      box.style.display = "block"
      box.style.left = `${rect.x}px`
      box.style.top = `${rect.y}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
      size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
      size.style.display = "block"
      // Below and right of the cursor; flipped to the other side near the window's right or bottom edge.
      const gap = 14
      const right = event.clientX + gap + size.offsetWidth > window.innerWidth
      const below = event.clientY + gap + size.offsetHeight <= window.innerHeight
      size.style.left = `${right ? event.clientX - gap - size.offsetWidth : event.clientX + gap}px`
      size.style.top = `${below ? event.clientY + gap : event.clientY - gap - size.offsetHeight}px`
    }
    const onUp = (event: MouseEvent) => {
      swallow(event)
      if (!start) return
      const rect = rectTo(event.clientX, event.clientY)
      finish(
        rect.width < minDrag || rect.height < minDrag ? { kind: "visible" } : { kind: "area", rect, pixelRatio: window.devicePixelRatio },
        true,
      )
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      swallow(event)
      finish({ kind: "cancel" })
    }
    // A touch or pen drag the browser turned into a scroll would leave the overlay waiting.
    const onCancel = () => finish({ kind: "cancel" })
    const listeners: Array<[string, (event: never) => void]> = [
      ["pointerdown", onDown],
      ["pointermove", onMove],
      ["pointerup", onUp],
      ["pointercancel", onCancel],
      ["keydown", onKey],
      // The page doesn't see the clicks of the drag, nor a context menu.
      ["mousedown", swallow],
      ["mouseup", swallow],
      ["click", swallow],
      ["auxclick", swallow],
      ["contextmenu", swallow],
    ]
    for (const [type, listener] of listeners) window.addEventListener(type, listener as EventListener, true)

    function finish(pick: AreaPick, afterDrag = false) {
      for (const [type, listener] of listeners) {
        // After a drag, the click (and mouseup) that follow the last pointerup still belong to it;
        // after Esc, the reporter's next click is theirs.
        const late = afterDrag && (type === "click" || type === "auxclick" || type === "mouseup")
        if (late) setTimeout(() => window.removeEventListener(type, listener as EventListener, true), 300)
        else window.removeEventListener(type, listener as EventListener, true)
      }
      host.remove()
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          busy.bugberryPicking = false
          resolve(pick)
        }),
      )
    }
  })
}

const isSize = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** The page controls the answer, so only a well-formed one is used. */
export function areaPickFrom(raw: unknown): AreaPick | null {
  if (typeof raw !== "object" || raw === null) return null
  const value = raw as { kind?: unknown; rect?: unknown; pixelRatio?: unknown }
  if (value.kind === "visible" || value.kind === "cancel") return { kind: value.kind }
  if (value.kind !== "area" || typeof value.rect !== "object" || value.rect === null) return null
  const { x, y, width, height } = value.rect as Record<string, unknown>
  if (!isSize(x) || !isSize(y) || !isSize(width) || !isSize(height) || width <= 0 || height <= 0) return null
  if (!isSize(value.pixelRatio) || value.pixelRatio <= 0) return null
  return { kind: "area", rect: { x, y, width, height }, pixelRatio: value.pixelRatio }
}

/** The box in the screenshot's device pixels, kept inside the image. */
export function cropBox(rect: AreaRect, pixelRatio: number, image: { width: number; height: number }): AreaRect {
  const x = Math.min(Math.max(0, Math.round(rect.x * pixelRatio)), image.width)
  const y = Math.min(Math.max(0, Math.round(rect.y * pixelRatio)), image.height)
  const right = Math.min(image.width, Math.round((rect.x + rect.width) * pixelRatio))
  const bottom = Math.min(image.height, Math.round((rect.y + rect.height) * pixelRatio))
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}
