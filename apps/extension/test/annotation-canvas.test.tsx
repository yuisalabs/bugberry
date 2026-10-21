import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { AnnotationCanvas, type AnnotationCanvasHandle } from "../entrypoints/review/AnnotationCanvas"

const image = { width: 800, height: 600 } as ImageBitmap
const realBounds = HTMLCanvasElement.prototype.getBoundingClientRect

beforeEach(() => {
  // Drawn at half size on the page: a click at (100, 50) is the image's (200, 100).
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  HTMLCanvasElement.prototype.getBoundingClientRect = realBounds
})

const setup = () => {
  const ref = createRef<AnnotationCanvasHandle>()
  const { container } = render(<AnnotationCanvas ref={ref} image={image} initialShapes={[]} />)
  fireEvent.click(screen.getByRole("radio", { name: "Text" }))
  const canvas = container.querySelector("canvas") as HTMLCanvasElement
  return { ref, canvas }
}

describe("text annotations", () => {
  test("clicking with the Text tool opens a box on the picture; Enter adds the text there", () => {
    const { ref, canvas } = setup()
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    const box = screen.getByRole("textbox", { name: "Annotation text" }) as HTMLInputElement
    expect(box.closest("[data-slot=text-annotation]")?.getAttribute("style")).toContain("left: 25%")
    fireEvent.change(box, { target: { value: "Pay fails here" } })
    act(() => {
      fireEvent.keyDown(box, { key: "Enter" })
    })
    expect(screen.queryByRole("textbox", { name: "Annotation text" })).toBeNull()
    expect(ref.current?.getShapes()).toEqual([{ kind: "text", color: expect.any(String), at: { x: 200, y: 100 }, text: "Pay fails here" }])
  })

  test("Escape and an empty box add nothing", () => {
    const { ref, canvas } = setup()
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    const box = screen.getByRole("textbox", { name: "Annotation text" })
    fireEvent.change(box, { target: { value: "Never mind" } })
    act(() => {
      fireEvent.keyDown(box, { key: "Escape" })
    })
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    act(() => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Annotation text" }), { key: "Enter" })
    })
    expect(ref.current?.getShapes()).toEqual([])
  })

  test("leaving the box keeps what was typed", () => {
    const { ref, canvas } = setup()
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    const box = screen.getByRole("textbox", { name: "Annotation text" })
    fireEvent.change(box, { target: { value: "Kept" } })
    act(() => {
      fireEvent.blur(box)
    })
    expect(ref.current?.getShapes().map((shape) => (shape.kind === "text" ? shape.text : shape.kind))).toEqual(["Kept"])
  })
})
