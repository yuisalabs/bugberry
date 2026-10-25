import { describe, expect, jest, mock, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { NotesLayer, type NotesLayerHandle } from "../entrypoints/draw/NotesLayer"
import { NOTE_LIFE_MS } from "../lib/strokes"

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

  test("the click that places a note leaves its input focused, ready to type", () => {
    const { surface } = setup()
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 120 })
    const input = screen.getByRole("textbox", { name: "Note" })
    // The browser's mousedown default would move focus to the clicked surface, off the new input.
    const kept = !fireEvent.mouseDown(surface, { clientX: 100, clientY: 120 })
    expect(kept).toBe(true)
    expect(document.activeElement).toBe(input)
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

  test("a saved note fades away after a few seconds, like the strokes", async () => {
    jest.useFakeTimers()
    try {
      const { surface } = setup()
      fireEvent.pointerDown(surface, { clientX: 100, clientY: 120 })
      const input = screen.getByRole("textbox", { name: "Note" })
      fireEvent.change(input, { target: { value: "Spins forever" } })
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" })
      })
      const card = () => screen.queryByText("Spins forever")?.closest<HTMLElement>("[data-note]")
      act(() => jest.advanceTimersByTime(NOTE_LIFE_MS - 600))
      expect(card()?.style.opacity).toBe("1")
      act(() => jest.advanceTimersByTime(200))
      expect(card()?.style.opacity).toBe("0")
      act(() => jest.advanceTimersByTime(400))
      expect(card()).toBeFalsy()
    } finally {
      jest.useRealTimers()
    }
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
