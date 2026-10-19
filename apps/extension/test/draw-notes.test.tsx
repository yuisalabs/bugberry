import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { NotesLayer, type NotesLayerHandle } from "../entrypoints/draw/NotesLayer"

function setup(active = true) {
  const addNote = mock(async (_text: string) => ({ n: 1 }))
  const ref = createRef<NotesLayerHandle>()
  render(<NotesLayer ref={ref} active={active} author="Dana" addNote={addNote} />)
  const surface = screen.getByTestId("notes-surface")
  return { addNote, ref, surface }
}

describe("numbered notes", () => {
  test("a click places a note; Enter saves it with its number and the author", async () => {
    const { addNote, surface } = setup()
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 120 })
    const input = screen.getByRole("textbox", { name: "Note" })
    fireEvent.change(input, { target: { value: "Spins forever" } })
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    expect(addNote).toHaveBeenCalledWith("Spins forever")
    expect(screen.getByText("1")).toBeTruthy()
    expect(screen.getByText("Spins forever")).toBeTruthy()
    expect(screen.getByText("Dana · just now")).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull()
  })

  test("Esc drops an unsaved note", () => {
    const { addNote, surface } = setup()
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 120 })
    const handled = !fireEvent.keyDown(screen.getByRole("textbox", { name: "Note" }), { key: "Escape" })
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull()
    // Taken by the note, so the drawing layer doesn't also leave Draw.
    expect(handled).toBe(true)
    expect(addNote).not.toHaveBeenCalled()
  })

  test("an empty note is not saved", async () => {
    const { addNote, surface } = setup()
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 120 })
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Note" }), { key: "Enter" })
    })
    expect(addNote).not.toHaveBeenCalled()
  })

  test("Clear takes the notes off the screen", async () => {
    const { ref, surface } = setup()
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 120 })
    const input = screen.getByRole("textbox", { name: "Note" })
    fireEvent.change(input, { target: { value: "Spins forever" } })
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    act(() => ref.current?.clear())
    expect(screen.queryByText("Spins forever")).toBeNull()
  })

  test("while the Note tool isn't chosen, clicks place nothing", () => {
    const { surface } = setup(false)
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 120 })
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull()
  })
})
