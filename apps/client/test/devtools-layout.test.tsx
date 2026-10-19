import { afterEach, describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { DevtoolsResizer, DevtoolsToggle } from "../src/components/DevtoolsLayout"
import { clampDevtoolsWidth, readDevtools, saveDevtools } from "../src/lib/devtools-layout"

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
  test("dragging the edge left widens the panel, right narrows it", () => {
    const onResize = mock()
    render(<DevtoolsResizer width={600} onResize={onResize} onReset={() => {}} />)
    const edge = screen.getByRole("separator", { name: "Resize DevTools" })
    fireEvent.pointerDown(edge, { clientX: 1000 })
    fireEvent.pointerMove(window, { clientX: 900 })
    expect(onResize).toHaveBeenLastCalledWith(700)
    fireEvent.pointerMove(window, { clientX: 1100 })
    expect(onResize).toHaveBeenLastCalledWith(500)
    fireEvent.pointerUp(window)
    fireEvent.pointerMove(window, { clientX: 0 })
    expect(onResize).toHaveBeenCalledTimes(2)
  })

  test("arrow keys move it in steps, and a double click goes back to the default", () => {
    const onResize = mock()
    const onReset = mock()
    render(<DevtoolsResizer width={600} onResize={onResize} onReset={onReset} />)
    const edge = screen.getByRole("separator", { name: "Resize DevTools" })
    fireEvent.keyDown(edge, { key: "ArrowLeft" })
    expect(onResize).toHaveBeenLastCalledWith(632)
    fireEvent.keyDown(edge, { key: "ArrowRight" })
    expect(onResize).toHaveBeenLastCalledWith(568)
    fireEvent.doubleClick(edge)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
