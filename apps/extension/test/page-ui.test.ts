import { afterEach, describe, expect, mock, test } from "bun:test"
import { type BarPosition, clampPosition, createPageUi, uiStateNeeded } from "../lib/page-ui"

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"

function setup(saved: BarPosition | null = null, savedCamera: BarPosition | null = null) {
  const savePosition = mock((_position: BarPosition) => {})
  const saveCameraPosition = mock((_position: BarPosition) => {})
  const ui = createPageUi(document, window, {
    extensionUrl: (path) => `${ORIGIN}/${path}`,
    extensionOrigin: ORIGIN,
    savePosition,
    loadPosition: () => saved,
    saveCameraPosition,
    loadCameraPosition: () => savedCamera,
    shadowMode: "open",
    // happy-dom's events are never trusted; the real page layer only takes the reporter's own keys.
    trusted: () => true,
  })
  const root = () => document.querySelector("[data-bugberry-ui]")?.shadowRoot ?? null
  return { ui, savePosition, saveCameraPosition, root }
}

const post = (data: unknown, origin = ORIGIN) => window.dispatchEvent(new MessageEvent("message", { data, origin }))

afterEach(() => {
  for (const host of document.querySelectorAll("[data-bugberry-ui]")) host.remove()
})

describe("clampPosition", () => {
  test("keeps the bar on screen", () => {
    expect(clampPosition({ x: 2000, y: -5 }, { width: 300, height: 60 }, { width: 1280, height: 720 })).toEqual({ x: 980, y: 0 })
    expect(clampPosition({ x: 10, y: 20 }, { width: 300, height: 60 }, { width: 1280, height: 720 })).toEqual({ x: 10, y: 20 })
  })
})

describe("the recording layer", () => {
  test("one host, a bar for this recording and a drawing layer that lets clicks through", () => {
    const { ui, root } = setup()
    ui.showRecording("s1")
    ui.showRecording("s1")
    expect(document.querySelectorAll("[data-bugberry-ui]")).toHaveLength(1)
    const frames = [...(root()?.querySelectorAll("iframe") ?? [])]
    expect(frames).toHaveLength(2)
    const bar = frames.find((frame) => frame.src.includes("recorder-bar.html"))
    const draw = frames.find((frame) => frame.src.includes("draw.html"))
    expect(bar?.src).toBe(`${ORIGIN}/recorder-bar.html?session=s1`)
    expect(draw?.src).toBe(`${ORIGIN}/draw.html?session=s1`)
    expect(draw?.style.pointerEvents).toBe("none")
    ui.hideRecording()
    expect(root()).toBeNull()
  })

  test("the bar has no grip of its own: it is dragged from inside its frame", () => {
    const { ui, root } = setup()
    ui.showRecording("s1")
    expect(root()?.querySelector("[data-grip]")).toBeNull()
    expect(root()?.querySelector("[data-bar]")?.children).toHaveLength(1)
  })

  test("a drag inside the bar's frame moves the bar, and only that frame can drag it", () => {
    const { ui, root, savePosition } = setup({ x: 100, y: 100 })
    ui.showRecording("s1")
    const bar = root()?.querySelector("[data-bar]") as HTMLElement
    const barFrame = [...(root()?.querySelectorAll("iframe") ?? [])].find((frame) => frame.src.includes("recorder-bar.html"))
    // happy-dom gives frames no window of their own; this one stands in for the bar's.
    if (barFrame) Object.defineProperty(barFrame, "contentWindow", { value: window, configurable: true })
    const fromBar = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN, source: window }))
    // Another page of the extension can't move it.
    post({ bugberry: "bar-drag", phase: "start" })
    post({ bugberry: "bar-drag", phase: "move", dx: 300, dy: 0 })
    expect(bar.style.left).toBe("100px")

    fromBar({ bugberry: "bar-drag", phase: "start" })
    fromBar({ bugberry: "bar-drag", phase: "move", dx: 40, dy: -20 })
    expect([bar.style.left, bar.style.top]).toEqual(["140px", "80px"])
    expect(savePosition).not.toHaveBeenCalled()
    fromBar({ bugberry: "bar-drag", phase: "end", dx: 50, dy: 10 })
    expect([bar.style.left, bar.style.top]).toEqual(["150px", "110px"])
    expect(savePosition).toHaveBeenCalledWith({ x: 150, y: 110 })
  })

  test("only the extension's own pages are listened to", () => {
    const { ui, root } = setup()
    ui.showRecording("s1")
    const draw = () => [...(root()?.querySelectorAll("iframe") ?? [])].find((frame) => frame.src.includes("draw.html"))
    post({ bugberry: "drawing", on: true }, "https://evil.test")
    expect(draw()?.style.pointerEvents).toBe("none")
    post({ bugberry: "drawing", on: true })
    expect(draw()?.style.pointerEvents).toBe("auto")
    post({ bugberry: "bar-size", width: 640, height: 150 })
    const bar = [...(root()?.querySelectorAll("iframe") ?? [])].find((frame) => frame.src.includes("recorder-bar.html"))
    expect(bar?.style.width).toBe("640px")
    expect(bar?.style.height).toBe("150px")
  })

  test("the review opens over the page and closes when it asks", () => {
    const { ui, root } = setup()
    ui.showReview("d1")
    const review = root()?.querySelector("iframe")
    expect(review?.src).toBe(`${ORIGIN}/review.html?draft=d1&embedded=1`)
    // A cross-origin frame needs these allowed, for the player's fullscreen and for "Copy link".
    expect(review?.getAttribute("allow")).toBe("fullscreen; clipboard-write")
    post({ bugberry: "review-close" })
    expect(root()).toBeNull()
  })

  test("a prompt opens over the page, may ask for the microphone, and closes when it asks", () => {
    const { ui, root } = setup()
    ui.showPrompt("microphone", "t1")
    const prompt = root()?.querySelector("iframe")
    expect(prompt?.src).toBe(`${ORIGIN}/microphone.html?prompt=t1&embedded=1`)
    expect(prompt?.getAttribute("allow")).toBe("microphone")
    post({ bugberry: "prompt-close" })
    expect(root()).toBeNull()
  })

  test("the camera prompt may ask for the camera", () => {
    const { ui, root } = setup()
    ui.showPrompt("camera", "t1")
    expect(root()?.querySelector("iframe")?.getAttribute("allow")).toBe("camera")
  })
})

describe("the camera bubble", () => {
  const cameraFrame = (root: ShadowRoot | null) => [...(root?.querySelectorAll("iframe") ?? [])].find((frame) => frame.src.includes("camera-bubble.html"))
  const boxOf = (root: ShadowRoot | null) => root?.querySelector("[data-camera]") as HTMLElement | null

  test("the camera bubble is its own frame, allowed the camera", () => {
    const { ui, root } = setup()
    ui.showCamera("t1", "circle")
    const frame = cameraFrame(root())
    expect(frame?.src).toBe(`${ORIGIN}/camera-bubble.html?camera=t1`)
    expect(frame?.getAttribute("allow")).toBe("camera")
    expect([frame?.style.width, frame?.style.height]).toEqual(["96px", "96px"])
    expect(boxOf(root())?.style.borderRadius).toBe("50%")
    ui.hideCamera()
    expect(root()).toBeNull()
  })

  test("rectangle is wider, with rounded corners", () => {
    const { ui, root } = setup()
    ui.showCamera("t1", "rectangle")
    const frame = cameraFrame(root())
    expect([frame?.style.width, frame?.style.height]).toEqual(["144px", "96px"])
    expect(boxOf(root())?.style.borderRadius).toBe("16px")
  })

  test("it starts bottom-left, or where it was left", () => {
    const first = setup()
    first.ui.showCamera("t1", "circle")
    expect([boxOf(first.root())?.style.left, boxOf(first.root())?.style.top]).toEqual(["24px", `${window.innerHeight - 96 - 24}px`])
    first.ui.hideCamera()
    const again = setup(null, { x: 300, y: 200 })
    again.ui.showCamera("t1", "circle")
    expect([boxOf(again.root())?.style.left, boxOf(again.root())?.style.top]).toEqual(["300px", "200px"])
  })

  test("the same grant shown twice is one bubble; another grant replaces it", () => {
    const { ui, root } = setup()
    ui.showCamera("t1", "circle")
    ui.showCamera("t1", "circle")
    expect(root()?.querySelectorAll("[data-camera]")).toHaveLength(1)
    ui.showCamera("t2", "rectangle")
    expect(root()?.querySelectorAll("[data-camera]")).toHaveLength(1)
    expect(cameraFrame(root())?.src).toContain("camera=t2")
  })

  test("hiding the recording keeps the camera", () => {
    const { ui, root } = setup()
    ui.showRecording("s1")
    ui.showCamera("t1", "circle")
    ui.hideRecording()
    expect(cameraFrame(root())?.isConnected).toBe(true)
  })

  test("a drag from the camera's frame moves only the camera and saves its own place", () => {
    const { ui, root, savePosition, saveCameraPosition } = setup({ x: 400, y: 400 }, { x: 100, y: 100 })
    ui.showRecording("s1")
    ui.showCamera("t1", "circle")
    const frame = cameraFrame(root())
    // happy-dom gives frames no window of their own; this one stands in for the camera's.
    if (frame) Object.defineProperty(frame, "contentWindow", { value: window, configurable: true })
    const fromCamera = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN, source: window }))
    fromCamera({ bugberry: "bar-drag", phase: "start" })
    fromCamera({ bugberry: "bar-drag", phase: "end", dx: 30, dy: -10 })
    expect([boxOf(root())?.style.left, boxOf(root())?.style.top]).toEqual(["130px", "90px"])
    expect(saveCameraPosition).toHaveBeenCalledWith({ x: 130, y: 90 })
    expect(savePosition).not.toHaveBeenCalled()
    const bar = root()?.querySelector("[data-bar]") as HTMLElement
    expect(bar.style.left).toBe("400px")
  })

  test("a camera frame that fails takes itself away, and only that frame can say so", () => {
    const { ui, root } = setup()
    ui.showCamera("t1", "circle")
    post({ bugberry: "camera-failed" })
    expect(cameraFrame(root())).toBeDefined()
    const frame = cameraFrame(root())
    if (frame) Object.defineProperty(frame, "contentWindow", { value: window, configurable: true })
    window.dispatchEvent(new MessageEvent("message", { data: { bugberry: "camera-failed" }, origin: ORIGIN, source: window }))
    expect(root()).toBeNull()
  })
})

describe("countdown", () => {
  test("Esc cancels, and the overlay is gone", async () => {
    const { ui, root } = setup()
    const result = ui.countdown()
    expect(root()?.textContent).toContain("Recording starts in 3 seconds")
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(await result).toBe("cancel")
    expect(root()?.textContent ?? "").not.toContain("Recording starts")
  })
})

test("a page load only wakes the background while something is being recorded", () => {
  expect(uiStateNeeded({})).toBe(false)
  expect(uiStateNeeded({ recording: { draftId: "d1", tabId: 7, startedAt: 1 } })).toBe(true)
  // Between opening a tab recording and its take (the countdown), only the camera grant exists.
  expect(uiStateNeeded({ camera: { token: "t", tabId: 7 } })).toBe(true)
})

test("a page can't cancel the countdown with a made-up Esc", async () => {
  const ui = createPageUi(document, window, {
    extensionUrl: (path) => `${ORIGIN}/${path}`,
    extensionOrigin: ORIGIN,
    savePosition: () => {},
    loadPosition: () => null,
    shadowMode: "open",
    tickMs: 5,
  })
  const result = ui.countdown()
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
  expect(await result).toBe("done")
})

test("a hidden tab paints no frames; the countdown still ends", async () => {
  const realFrame = window.requestAnimationFrame
  window.requestAnimationFrame = () => 0
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
  try {
    const ui = createPageUi(document, window, {
      extensionUrl: (path) => `${ORIGIN}/${path}`,
      extensionOrigin: ORIGIN,
      savePosition: () => {},
      loadPosition: () => null,
      shadowMode: "open",
      tickMs: 5,
    })
    expect(await ui.countdown()).toBe("done")
  } finally {
    window.requestAnimationFrame = realFrame
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
  }
})

test("Esc pressed while the bar has focus cancels the countdown too, from the bar's frame only", async () => {
  const { ui, root } = setup()
  ui.showRecording("s1")
  const bar = [...(root()?.querySelectorAll("iframe") ?? [])].find((frame) => frame.src.includes("recorder-bar.html"))
  // happy-dom gives frames no window of their own; this one stands in for the bar's.
  if (bar) Object.defineProperty(bar, "contentWindow", { value: window, configurable: true })
  const result = ui.countdown()
  window.dispatchEvent(new MessageEvent("message", { data: { bugberry: "escape" }, origin: ORIGIN, source: window }))
  expect(await result).toBe("cancel")
})

test("Esc pressed while the camera bubble has focus cancels the countdown too", async () => {
  const { ui, root } = setup()
  ui.showCamera("t1", "circle")
  const frame = [...(root()?.querySelectorAll("iframe") ?? [])].find((element) => element.src.includes("camera-bubble.html"))
  if (frame) Object.defineProperty(frame, "contentWindow", { value: window, configurable: true })
  const result = ui.countdown()
  window.dispatchEvent(new MessageEvent("message", { data: { bugberry: "escape" }, origin: ORIGIN, source: window }))
  expect(await result).toBe("cancel")
})

test("an escape from another extension frame doesn't cancel the countdown", async () => {
  const { ui } = setup()
  ui.showRecording("s1")
  const result = ui.countdown()
  window.dispatchEvent(new MessageEvent("message", { data: { bugberry: "escape" }, origin: ORIGIN }))
  const done = await Promise.race([result, new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))])
  expect(done).toBe("waiting")
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
  await result
})

test("the page's own CSS can't hide the layer", () => {
  const { ui } = setup()
  ui.showRecording("s1")
  const host = document.querySelector("[data-bugberry-ui]") as HTMLElement
  for (const property of ["display", "position", "z-index", "visibility", "opacity"]) {
    expect(host.style.getPropertyPriority(property)).toBe("important")
  }
})
