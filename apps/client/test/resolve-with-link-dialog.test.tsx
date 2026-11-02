import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ResolveWithLinkForm } from "../src/features/reports/detail/ResolveWithLinkDialog"

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe("ResolveWithLinkForm", () => {
  test("submits trimmed links and the note", () => {
    const onSubmit = mock()
    render(<ResolveWithLinkForm saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />)
    type("Fix link URL", " https://github.com/o/r/pull/1 ")
    fireEvent.click(screen.getByRole("button", { name: "Add another link" }))
    type("Fix link URL 2", "https://github.com/o/r/commit/abc")
    type("Note for the reporter", "  Done  ")
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
    expect(onSubmit).toHaveBeenCalledWith({ links: ["https://github.com/o/r/pull/1", "https://github.com/o/r/commit/abc"], note: "Done" })
  })

  test("leaves out empty extra fields and an empty note", () => {
    const onSubmit = mock()
    render(<ResolveWithLinkForm saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />)
    type("Fix link URL", "https://x.test/1")
    fireEvent.click(screen.getByRole("button", { name: "Add another link" }))
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
    expect(onSubmit).toHaveBeenCalledWith({ links: ["https://x.test/1"] })
  })

  test("Resolve stays off until a link is typed, and the server's error shows", () => {
    render(<ResolveWithLinkForm saving={false} error="Enter an http or https link" onSubmit={() => {}} onCancel={() => {}} />)
    expect((screen.getByRole("button", { name: "Resolve" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("alert").textContent).toBe("Enter an http or https link")
  })
})
