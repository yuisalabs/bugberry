import { afterEach, describe, expect, mock, test } from "bun:test"
import { type BarDragMessage, startBarDrag, startCameraResize } from "../../lib/recording/bar-drag"

function bar() {
  document.body.innerHTML = '<div id="pill"><span id="clock">00:02</span><button id="stop">Stop</button></div>'
  const pill = document.getElementById("pill") as HTMLElement
  const post = mock((_message: BarDragMessage) => {})
  const deps = { post, requestFrame: (run: () => void) => (run(), 1), cancelFrame: () => {} }
  return { pill, post, deps }
}

/** A press dispatched on `target`, handed to the drag the way the bar's surface handler does. */
function pressOn(target: Element, pill: HTMLElement, deps: Parameters<typeof startBarDrag>[2]) {
  const down = new PointerEvent("pointerdown", { button: 0, bubbles: true, screenX: 100, screenY: 50 })
  let started = false
  target.addEventListener("pointerdown", (event) => (started = startBarDrag(event as PointerEvent, pill, deps)), { once: true })
  target.dispatchEvent(down)
  return started
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("startBarDrag", () => {
  test("a press beside the buttons drags; a press on a button does not", () => {
    const { pill, post, deps } = bar()
    expect(pressOn(document.getElementById("stop") as Element, pill, deps)).toBe(false)
    expect(post).not.toHaveBeenCalled()
    expect(pressOn(document.getElementById("clock") as Element, pill, deps)).toBe(true)
    expect(post).toHaveBeenLastCalledWith({ bugberry: "bar-drag", phase: "start" })
  })

  test("moves are measured on the screen, and the end says where it stopped", () => {
    const { pill, post, deps } = bar()
    pressOn(document.getElementById("clock") as Element, pill, deps)
    pill.dispatchEvent(new PointerEvent("pointermove", { screenX: 130, screenY: 40 }))
    expect(post).toHaveBeenLastCalledWith({ bugberry: "bar-drag", phase: "move", dx: 30, dy: -10 })
    pill.dispatchEvent(new PointerEvent("pointerup", { screenX: 160, screenY: 70 }))
    expect(post).toHaveBeenLastCalledWith({ bugberry: "bar-drag", phase: "end", dx: 60, dy: 20 })
    // Once it ended, further moves go nowhere.
    pill.dispatchEvent(new PointerEvent("pointermove", { screenX: 400, screenY: 400 }))
    expect(post).toHaveBeenCalledTimes(3)
  })

  test("many moves within one frame send one update", () => {
    const { pill, post } = bar()
    const frames: Array<() => void> = []
    const deps = { post, requestFrame: (run: () => void) => frames.push(run), cancelFrame: () => {} }
    pressOn(document.getElementById("clock") as Element, pill, deps)
    for (const x of [110, 120, 130]) pill.dispatchEvent(new PointerEvent("pointermove", { screenX: x, screenY: 50 }))
    expect(frames).toHaveLength(1)
    frames[0]?.()
    expect(post).toHaveBeenLastCalledWith({ bugberry: "bar-drag", phase: "move", dx: 30, dy: 0 })
    expect(post).toHaveBeenCalledTimes(2)
  })
})

describe("startCameraResize", () => {
  test("a press on the camera's handle sends resize moves, measured on the screen, even though it is a button", () => {
    document.body.innerHTML = '<div id="bubble"><button id="handle">Resize</button></div>'
    const bubble = document.getElementById("bubble") as HTMLElement
    const handle = document.getElementById("handle") as HTMLElement
    const post = mock((_message: unknown) => {})
    const deps = { post, requestFrame: (run: () => void) => (run(), 1), cancelFrame: () => {} }
    let started = false
    handle.addEventListener("pointerdown", (event) => (started = startCameraResize(event as PointerEvent, bubble, deps)), { once: true })
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, screenX: 100, screenY: 50 }))
    expect(started).toBe(true)
    expect(post).toHaveBeenLastCalledWith({ bugberry: "camera-resize", phase: "start" })
    bubble.dispatchEvent(new PointerEvent("pointermove", { screenX: 120, screenY: 30 }))
    expect(post).toHaveBeenLastCalledWith({ bugberry: "camera-resize", phase: "move", dx: 20, dy: -20 })
    bubble.dispatchEvent(new PointerEvent("pointerup", { screenX: 140, screenY: 20 }))
    expect(post).toHaveBeenLastCalledWith({ bugberry: "camera-resize", phase: "end", dx: 40, dy: -30 })
  })
})
