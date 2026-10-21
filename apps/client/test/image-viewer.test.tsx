import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ImageViewer } from "../src/components/ImageViewer"

describe("ImageViewer toolbar", () => {
  test("every toolbar icon stays white on the dark backdrop, also while zoomed in or hovered", () => {
    render(<ImageViewer src="https://cdn.test/shot.png" alt="Screenshot" isOpen onOpenChange={mock()} />)
    const zoom = screen.getByRole("button", { name: "Actual size" })
    // Intent colours a Toggle's icon through these variables on hover and when selected, and a Button's likewise.
    for (const name of ["Actual size", "Download screenshot", "Close"]) {
      const control = screen.getByRole(name === "Download screenshot" ? "link" : "button", { name })
      expect(control.className).toContain("[--toggle-icon:var(--color-white)]")
      expect(control.className).toContain("[--toggle-icon-active:var(--color-white)]")
      expect(control.className).toContain("[--btn-icon:var(--color-white)]")
      expect(control.className).toContain("[--btn-icon-active:var(--color-white)]")
    }
    fireEvent.click(zoom)
    expect(screen.getByRole("button", { name: "Fit to screen" }).className).toContain("[--toggle-icon-active:var(--color-white)]")
  })
})
