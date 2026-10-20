import { afterEach, describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { DevtoolsResizer, DevtoolsToggle } from "../src/components/DevtoolsLayout"
import { clampDevtoolsWidth, devtoolsColumn, readDevtools, saveDevtools } from "../src/lib/devtools-layout"

afterEach(() => window.localStorage.clear())

describe("the DevTools layout this browser remembers", () => {
  test("open with the default width when nothing is stored", () => {
    expect(readDevtools()).toEqual({ open: true, width: null })
  })

  test("hidden and a chosen width come back", () => {
    saveDevtools({ open: false, width: 640 })
    expect(readDevtools()).toEqual({ open: false, width: 640 })
  })

  test("a damaged value is ignored", () => {
    window.localStorage.setItem("bugberry:devtools", "{nope")
    expect(readDevtools()).toEqual({ open: true, width: null })
  })

  test("the panel keeps a usable width, and leaves the report room", () => {
    expect(clampDevtoolsWidth(100, 1920)).toBe(360)
    expect(clampDevtoolsWidth(700, 1920)).toBe(700)
    // The report keeps at least 560 px.
    expect(clampDevtoolsWidth(1700, 1920)).toBe(1360)
  })

  test("the grid column: 42% by default, a chosen width never crowding the report", () => {
    expect(devtoolsColumn(null)).toBe("max(420px,42%)")
    expect(devtoolsColumn(640)).toBe("min(640px, calc(100% - 560px))")
  })
})

describe("DevtoolsToggle", () => {
  test("hides and shows the panel", () => {
    const onToggle = mock()
    const { rerender } = render(<DevtoolsToggle open onToggle={onToggle} />)
    fireEvent.click(screen.getByRole("button", { name: "Hide DevTools" }))
    expect(onToggle).toHaveBeenCalledWith(false)
    rerender(<DevtoolsToggle open={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole("button", { name: "Show DevTools" }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})

describe("DevtoolsResizer", () => {
  test("a drag previews on every move and settles once, where it was let go", () => {
    const onDrag = mock()
    const onResize = mock()
    render(<DevtoolsResizer width={600} measure={() => 0} onDrag={onDrag} onResize={onResize} onReset={() => {}} />)
    const edge = screen.getByRole("separator", { name: "Resize DevTools" })
    fireEvent.pointerDown(edge, { clientX: 1000 })
    // Dragging the edge left widens the panel, right narrows it.
    fireEvent.pointerMove(window, { clientX: 900 })
    expect(onDrag).toHaveBeenLastCalledWith(700)
    fireEvent.pointerMove(window, { clientX: 1100 })
    expect(onDrag).toHaveBeenLastCalledWith(500)
    expect(onResize).not.toHaveBeenCalled()
    fireEvent.pointerUp(window)
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith(500)
    fireEvent.pointerMove(window, { clientX: 0 })
    expect(onDrag).toHaveBeenCalledTimes(2)
  })

  test("a press without a move changes nothing", () => {
    const onResize = mock()
    render(<DevtoolsResizer width={600} measure={() => 0} onDrag={() => {}} onResize={onResize} onReset={() => {}} />)
    const edge = screen.getByRole("separator", { name: "Resize DevTools" })
    fireEvent.pointerDown(edge, { clientX: 1000 })
    fireEvent.pointerUp(window)
    expect(onResize).not.toHaveBeenCalled()
  })

  test("from the default width, a drag starts at the panel's width on screen", () => {
    const onResize = mock()
    render(<DevtoolsResizer width={null} measure={() => 640} onDrag={() => {}} onResize={onResize} onReset={() => {}} />)
    const edge = screen.getByRole("separator", { name: "Resize DevTools" })
    fireEvent.pointerDown(edge, { clientX: 1000 })
    fireEvent.pointerMove(window, { clientX: 960 })
    fireEvent.pointerUp(window)
    expect(onResize).toHaveBeenCalledWith(680)
  })

  test("arrow keys move it in steps, and a double click goes back to the default", () => {
    const onResize = mock()
    const onReset = mock()
    render(<DevtoolsResizer width={600} measure={() => 0} onDrag={() => {}} onResize={onResize} onReset={onReset} />)
    const edge = screen.getByRole("separator", { name: "Resize DevTools" })
    fireEvent.keyDown(edge, { key: "ArrowLeft" })
    expect(onResize).toHaveBeenLastCalledWith(632)
    fireEvent.keyDown(edge, { key: "ArrowRight" })
    expect(onResize).toHaveBeenLastCalledWith(568)
    fireEvent.doubleClick(edge)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
