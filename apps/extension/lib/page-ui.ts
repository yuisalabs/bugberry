import type { CameraShape } from "./capture/capture-prefs"

/** Top-left corner of the Recording Bar (or the camera bubble), in CSS pixels of the viewport. */
export interface BarPosition {
  x: number
  y: number
}

export interface PageUiDeps {
  extensionUrl(path: string): string
  /** Only messages from the extension's own frames are acted on. */
  extensionOrigin: string
  savePosition(position: BarPosition): void
  loadPosition(): BarPosition | null
  /** The camera bubble's place, kept apart from the bar's. */
  saveCameraPosition?(position: BarPosition): void
  loadCameraPosition?(): BarPosition | null
  /** The camera bubble's height, set with its corner handle; one for both shapes. */
  saveCameraHeight?(height: number): void
  loadCameraHeight?(): number | null
  /** "closed" in the page, so page scripts can't reach in; tests use "open". */
  shadowMode?: ShadowRootMode
  /** Whether a key event came from the reporter. A page can dispatch its own; tests' events are never trusted. */
  trusted?: (event: Event) => boolean
  /** One countdown step, 1000 ms; shorter in tests. */
  tickMs?: number
}

export interface PageUi {
  showRecording(session: string): void
  hideRecording(): void
  countdown(): Promise<"done" | "cancel">
  showReview(draftId: string): void
  hideReview(): void
  /** A prompt page (allow the microphone, switch servers) over the page; `token` names what it asks. */
  showPrompt(page: string, token: string): void
  hidePrompt(): void
  setDrawing(on: boolean): void
  /** The camera bubble for the recording's camera grant `token`; apart from the bar, so a Restart keeps it. */
  showCamera(token: string, shape: CameraShape): void
  hideCamera(): void
}

const BAR_SIZE = { width: 560, height: 96 }
const BOTTOM_GAP = 24
const COUNTDOWN_SECONDS = 3
/** The camera bubble's height in CSS pixels: what it starts at, and how far its corner handle can take it. */
export const CAMERA_HEIGHT = { initial: 160, min: 96, max: 320 }
/** Width for each pixel of height: a circle stays round, a rectangle 3:2. */
const CAMERA_ASPECT: Record<CameraShape, number> = { circle: 1, rectangle: 1.5 }
/** The camera bubble starts bottom-left, away from the bar. */
const CAMERA_GAP = 24

/** A stored camera height; anything but a finite number is none (the page layer keeps it within range). */
export function cameraHeightFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function cameraSize(shape: CameraShape, height: number): { width: number; height: number } {
  return { width: Math.round(height * CAMERA_ASPECT[shape]), height }
}

/**
 * Whether a page load should ask the background if its tab is being recorded. The recording state sits in
 * session storage, which content scripts can read, so an ordinary page load never wakes the worker.
 */
export function uiStateNeeded(stored: Record<string, unknown>): boolean {
  const present = (value: unknown) => typeof value === "object" && value !== null
  // A tab recording's camera grant comes before its recording state: during the countdown there is only that.
  return present(stored.recording) || present(stored.camera)
}

/** The camera bubble a ui-state answer brings back after a reload; null when there is none or it is malformed. */
export function cameraFromUiState(state: unknown): { token: string; shape: CameraShape } | null {
  const camera = (state as { camera?: { token?: unknown; shape?: unknown } } | null)?.camera
  return typeof camera?.token === "string" && (camera.shape === "circle" || camera.shape === "rectangle") ? { token: camera.token, shape: camera.shape } : null
}

/** Keeps a box of `size` inside the viewport. */
export function clampPosition(
  position: BarPosition,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): BarPosition {
  return {
    x: Math.round(Math.min(Math.max(0, position.x), Math.max(0, viewport.width - size.width))),
    y: Math.round(Math.min(Math.max(0, position.y), Math.max(0, viewport.height - size.height))),
  }
}

function frame(doc: Document, src: string, style: string): HTMLIFrameElement {
  const element = doc.createElement("iframe")
  element.src = src
  element.setAttribute("allowtransparency", "true")
  element.style.cssText = `border:0;background:transparent;color-scheme:normal;${style}`
  return element
}

/**
 * The next painted frame. A hidden tab paints none, so there it waits 100 ms instead; a visible page always
 * waits for the paint, so the overlay can't be in the first frame of a tab recording.
 */
const nextFrame = (win: Window) =>
  new Promise<void>((resolve) => {
    if (win.document.visibilityState === "hidden") win.setTimeout(resolve, 100)
    else win.requestAnimationFrame(() => resolve())
  })

/**
 * Everything BugBerry shows on a page while recording and reviewing: one host element with a closed shadow
 * root (so page styles and scripts stay out), holding the countdown and the extension
 * pages that hold anything private (the bar, the drawing layer, the review) in iframes.
 */
export function createPageUi(doc: Document, win: Window, deps: PageUiDeps): PageUi {
  let host: HTMLElement | null = null
  let root: ShadowRoot | null = null
  let recording: { session: string; bar: HTMLElement; barFrame: HTMLIFrameElement; draw: HTMLIFrameElement } | null = null
  let review: HTMLIFrameElement | null = null
  let prompt: HTMLIFrameElement | null = null
  let barSize = { ...BAR_SIZE }
  /** Set while a countdown runs: the bar's frame forwards Esc when it has the focus. */
  let cancelCountdown: (() => void) | null = null
  /** Where the bar was when the drag under way started; the bar's frame reports how far it has moved since. */
  let dragFrom: BarPosition | null = null
  let camera: {
    token: string
    shape: CameraShape
    height: number
    box: HTMLElement
    frame: HTMLIFrameElement
    dragFrom: BarPosition | null
    /** The height and bottom-left corner when the resize under way started. */
    resizeFrom: { height: number; left: number; bottom: number } | null
  } | null = null

  const viewport = () => ({ width: win.innerWidth, height: win.innerHeight })
  const outerSize = () => barSize

  const ensureRoot = (): ShadowRoot => {
    if (root && host?.isConnected) return root
    host = doc.createElement("div")
    host.setAttribute("data-bugberry-ui", "")
    // Important, so a page's own !important rules can't hide or move the layer.
    const styles: Array<[string, string]> = [
      ["all", "initial"],
      ["display", "block"],
      ["position", "fixed"],
      ["top", "0"],
      ["left", "0"],
      ["width", "0"],
      ["height", "0"],
      ["z-index", "2147483647"],
      ["visibility", "visible"],
      ["opacity", "1"],
    ]
    for (const [property, value] of styles) host.style.setProperty(property, value, "important")
    root = host.attachShadow({ mode: deps.shadowMode ?? "closed" })
    doc.documentElement.append(host)
    return root
  }

  const removeHostIfEmpty = () => {
    if (root && root.childElementCount === 0) {
      host?.remove()
      host = null
      root = null
    }
  }

  const place = (bar: HTMLElement, position: BarPosition, size = outerSize()) => {
    const clamped = clampPosition(position, size, viewport())
    bar.style.left = `${clamped.x}px`
    bar.style.top = `${clamped.y}px`
    return clamped
  }
  const positionOf = (bar: HTMLElement): BarPosition => ({ x: Number.parseFloat(bar.style.left) || 0, y: Number.parseFloat(bar.style.top) || 0 })

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== deps.extensionOrigin) return
    const data = (typeof event.data === "object" && event.data !== null ? event.data : {}) as Record<string, unknown>
    if (data.bugberry === "escape") {
      const fromBar = recording && event.source === recording.barFrame.contentWindow
      const fromCamera = camera && event.source === camera.frame.contentWindow
      if (event.source !== null && (fromBar || fromCamera)) cancelCountdown?.()
    }
    else if (data.bugberry === "bar-drag" && recording && event.source !== null && event.source === recording.barFrame.contentWindow) {
      onBarDrag(recording.bar, data)
    }
    else if (data.bugberry === "bar-drag" && camera && event.source !== null && event.source === camera.frame.contentWindow) {
      onCameraDrag(camera, data)
    }
    else if (data.bugberry === "camera-resize" && camera && event.source !== null && event.source === camera.frame.contentWindow) {
      onCameraResize(camera, data)
    }
    else if (data.bugberry === "camera-failed" && camera && event.source !== null && event.source === camera.frame.contentWindow) {
      ui.hideCamera()
    }
    else if (data.bugberry === "drawing") ui.setDrawing(data.on === true)
    else if (data.bugberry === "review-close") ui.hideReview()
    else if (data.bugberry === "prompt-close") ui.hidePrompt()
    else if (data.bugberry === "bar-size" && recording && typeof data.width === "number" && typeof data.height === "number") {
      const before = barSize.height
      barSize = { width: Math.max(1, Math.round(data.width)), height: Math.max(1, Math.round(data.height)) }
      recording.barFrame.style.width = `${barSize.width}px`
      recording.barFrame.style.height = `${barSize.height}px`
      // The bar grows upwards (toolbars and confirmations open above it): its bottom edge stays put.
      const at = positionOf(recording.bar)
      place(recording.bar, { x: at.x, y: at.y + before - barSize.height })
    }
  }
  /** A drag started inside the bar's frame (anywhere but its buttons): it sends how far it has moved. */
  const onBarDrag = (bar: HTMLElement, data: Record<string, unknown>) => {
    if (data.phase === "start") {
      dragFrom = positionOf(bar)
      return
    }
    if (!dragFrom || typeof data.dx !== "number" || typeof data.dy !== "number") return
    const at = place(bar, { x: dragFrom.x + data.dx, y: dragFrom.y + data.dy })
    if (data.phase === "end") {
      dragFrom = null
      deps.savePosition(at)
    }
  }
  /** The camera's frame sends its drags like the bar's; the bubble keeps a place of its own. */
  const onCameraDrag = (bubble: NonNullable<typeof camera>, data: Record<string, unknown>) => {
    if (data.phase === "start") {
      bubble.dragFrom = positionOf(bubble.box)
      return
    }
    if (!bubble.dragFrom || typeof data.dx !== "number" || typeof data.dy !== "number") return
    const at = place(bubble.box, { x: bubble.dragFrom.x + data.dx, y: bubble.dragFrom.y + data.dy }, cameraSize(bubble.shape, bubble.height))
    if (data.phase === "end") {
      bubble.dragFrom = null
      deps.saveCameraPosition?.(at)
    }
  }
  /** As high as the window allows, past the gap on either side, and within the handle's range. */
  const cameraHeight = (shape: CameraShape, height: number) => {
    const { width, height: tall } = viewport()
    const fits = Math.min(CAMERA_HEIGHT.max, tall - 2 * CAMERA_GAP, (width - 2 * CAMERA_GAP) / CAMERA_ASPECT[shape])
    return Math.round(Math.max(CAMERA_HEIGHT.min, Math.min(fits, height)))
  }
  const sizeCamera = (bubble: NonNullable<typeof camera>, height: number) => {
    bubble.height = height
    const { width } = cameraSize(bubble.shape, height)
    for (const element of [bubble.box, bubble.frame]) {
      element.style.width = `${width}px`
      element.style.height = `${height}px`
    }
  }
  /**
   * The handle at the top-right corner: up and to the right grows the bubble, by the average of the two
   * moves (in height), while its bottom-left corner stays where it is.
   */
  const onCameraResize = (bubble: NonNullable<typeof camera>, data: Record<string, unknown>) => {
    if (data.phase === "start") {
      const at = positionOf(bubble.box)
      bubble.resizeFrom = { height: bubble.height, left: at.x, bottom: at.y + bubble.height }
      return
    }
    const from = bubble.resizeFrom
    if (!from || typeof data.dx !== "number" || typeof data.dy !== "number") return
    const height = cameraHeight(bubble.shape, from.height + (data.dx / CAMERA_ASPECT[bubble.shape] - data.dy) / 2)
    sizeCamera(bubble, height)
    const at = place(bubble.box, { x: from.left, y: from.bottom - height }, cameraSize(bubble.shape, height))
    if (data.phase === "end") {
      bubble.resizeFrom = null
      deps.saveCameraHeight?.(height)
      deps.saveCameraPosition?.(at)
    }
  }
  const onResize = () => {
    if (recording) place(recording.bar, positionOf(recording.bar))
    if (camera) {
      sizeCamera(camera, cameraHeight(camera.shape, camera.height))
      place(camera.box, positionOf(camera.box), cameraSize(camera.shape, camera.height))
    }
  }
  win.addEventListener("message", onMessage)
  win.addEventListener("resize", onResize)

  const ui: PageUi = {
    showRecording(session) {
      if (recording?.session === session && recording.bar.isConnected) return
      ui.hideRecording()
      const shadow = ensureRoot()
      // The drawing layer goes first, so the bar stays clickable above it.
      const draw = frame(doc, deps.extensionUrl(`draw.html?session=${encodeURIComponent(session)}`), "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none")
      const bar = doc.createElement("div")
      bar.setAttribute("data-bar", "")
      bar.style.cssText = "position:fixed;display:flex;align-items:flex-end"
      barSize = { ...BAR_SIZE }
      const barFrame = frame(doc, deps.extensionUrl(`recorder-bar.html?session=${encodeURIComponent(session)}`), `width:${barSize.width}px;height:${barSize.height}px`)
      // The bar is dragged from anywhere on it but its buttons; its frame sends the moves (lib/bar-drag.ts).
      bar.append(barFrame)
      // Drawing layer, camera bubble, bar: strokes never cover the reporter's face, and the bar stays on top.
      if (camera?.box.parentNode === shadow) {
        camera.box.before(draw)
        camera.box.after(bar)
      } else shadow.append(draw, bar)
      const { width, height } = viewport()
      place(bar, deps.loadPosition() ?? { x: (width - outerSize().width) / 2, y: height - outerSize().height - BOTTOM_GAP })

      recording = { session, bar, barFrame, draw }
    },

    hideRecording() {
      recording?.bar.remove()
      recording?.draw.remove()
      recording = null
      removeHostIfEmpty()
    },

    countdown() {
      const shadow = ensureRoot()
      const overlay = doc.createElement("div")
      overlay.style.cssText =
        "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(28,16,34,0.45);font-family:system-ui,sans-serif;color:#fff"
      const circle = doc.createElement("div")
      circle.style.cssText =
        "width:96px;height:96px;border-radius:50%;display:grid;place-items:center;font-size:44px;font-weight:700;background:rgba(28,16,34,0.6);border:4px solid #d61f69"
      const title = doc.createElement("p")
      title.textContent = `Recording starts in ${COUNTDOWN_SECONDS} seconds`
      title.style.cssText = "margin:0;font-size:16px;font-weight:600"
      const hint = doc.createElement("p")
      hint.style.cssText = "margin:0;font-size:13px;opacity:0.8"
      const key = doc.createElement("kbd")
      key.textContent = "Esc"
      key.style.cssText = "padding:1px 6px;border-radius:4px;background:rgba(255,255,255,0.2);font-family:inherit"
      hint.append(key, " to cancel")
      overlay.append(circle, title, hint)
      shadow.append(overlay)

      return new Promise((resolve) => {
        let left = COUNTDOWN_SECONDS
        circle.textContent = String(left)
        const finish = async (result: "done" | "cancel") => {
          cancelCountdown = null
          win.clearInterval(timer)
          win.removeEventListener("keydown", onKey, true)
          overlay.remove()
          removeHostIfEmpty()
          // Two painted frames without the overlay, so a tab recording never shows it.
          if (result === "done") {
            await nextFrame(win)
            await nextFrame(win)
          }
          resolve(result)
        }
        const onKey = (event: KeyboardEvent) => {
          if (event.key !== "Escape" || !(deps.trusted ?? ((key: Event) => key.isTrusted))(event)) return
          // The page doesn't get this Esc: it was meant for the countdown.
          event.preventDefault()
          event.stopImmediatePropagation()
          void finish("cancel")
        }
        const timer = win.setInterval(() => {
          left -= 1
          if (left <= 0) void finish("done")
          else circle.textContent = String(left)
        }, deps.tickMs ?? 1000)
        win.addEventListener("keydown", onKey, true)
        cancelCountdown = () => void finish("cancel")
      })
    },

    showReview(draftId) {
      ui.hideReview()
      review = frame(doc, deps.extensionUrl(`review.html?draft=${encodeURIComponent(draftId)}&embedded=1`), "position:fixed;inset:0;width:100vw;height:100vh")
      // A cross-origin frame needs these allowed: the player's fullscreen and "Copy link".
      review.setAttribute("allow", "fullscreen; clipboard-write")
      ensureRoot().append(review)
    },

    hideReview() {
      review?.remove()
      review = null
      removeHostIfEmpty()
    },

    showPrompt(page, token) {
      ui.hidePrompt()
      prompt = frame(doc, deps.extensionUrl(`${page}.html?prompt=${encodeURIComponent(token)}&embedded=1`), "position:fixed;inset:0;width:100vw;height:100vh")
      // The microphone and camera prompts ask for them from inside this frame.
      prompt.setAttribute("allow", page === "camera" ? "camera" : "microphone")
      ensureRoot().append(prompt)
    },

    hidePrompt() {
      prompt?.remove()
      prompt = null
      removeHostIfEmpty()
    },

    setDrawing(on) {
      if (recording) recording.draw.style.pointerEvents = on ? "auto" : "none"
    },

    showCamera(token, shape) {
      if (camera?.token === token && camera.box.isConnected) return
      ui.hideCamera()
      const size = cameraSize(shape, cameraHeight(shape, deps.loadCameraHeight?.() ?? CAMERA_HEIGHT.initial))
      const box = doc.createElement("div")
      box.setAttribute("data-camera", "")
      box.style.cssText = `position:fixed;overflow:hidden;width:${size.width}px;height:${size.height}px;border-radius:${shape === "circle" ? "50%" : "16px"};box-shadow:0 6px 20px rgba(28,16,34,0.35)`
      const cameraFrame = frame(doc, deps.extensionUrl(`camera-bubble.html?camera=${encodeURIComponent(token)}`), `width:${size.width}px;height:${size.height}px;display:block`)
      // The bubble's page asks for the camera from inside this frame.
      cameraFrame.setAttribute("allow", "camera")
      box.append(cameraFrame)
      const shadow = ensureRoot()
      if (recording?.bar.parentNode === shadow) recording.bar.before(box)
      else shadow.append(box)
      place(box, deps.loadCameraPosition?.() ?? { x: CAMERA_GAP, y: viewport().height - size.height - CAMERA_GAP }, size)
      camera = { token, shape, height: size.height, box, frame: cameraFrame, dragFrom: null, resizeFrom: null }
    },

    hideCamera() {
      camera?.box.remove()
      camera = null
      removeHostIfEmpty()
    },
  }
  return ui
}
