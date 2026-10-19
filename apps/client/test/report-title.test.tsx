import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ReportTitle } from "../src/components/report/ReportTitle"

const edit = () => fireEvent.click(screen.getByRole("button", { name: "Pay button fails" }))
const input = () => screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement

describe("ReportTitle", () => {
  test("Enter saves a trimmed, changed title", () => {
    const onSave = mock()
    render(<ReportTitle title="Pay button fails" editable onSave={onSave} />)
    edit()
    fireEvent.change(input(), { target: { value: "  Pay button hangs  " } })
    fireEvent.keyDown(input(), { key: "Enter" })
    expect(onSave).toHaveBeenCalledWith("Pay button hangs")
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  test("Escape restores the title", () => {
    const onSave = mock()
    render(<ReportTitle title="Pay button fails" editable onSave={onSave} />)
    edit()
    fireEvent.change(input(), { target: { value: "Something else" } })
    fireEvent.keyDown(input(), { key: "Escape" })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "Pay button fails" })).toBeTruthy()
  })

  test("an empty or unchanged title is not saved", () => {
    const onSave = mock()
    render(<ReportTitle title="Pay button fails" editable onSave={onSave} />)
    edit()
    fireEvent.change(input(), { target: { value: "   " } })
    fireEvent.blur(input())
    edit()
    fireEvent.blur(input())
    expect(onSave).not.toHaveBeenCalled()
  })

  test("a read-only title is plain text", () => {
    render(<ReportTitle title="Pay button fails" editable={false} onSave={mock()} />)
    expect(screen.getByRole("heading", { name: "Pay button fails" })).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
