import { describe, expect, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { EmailChips } from "../src/components/EmailChips"

function Harness() {
  const [emails, setEmails] = useState<string[]>([])
  return <EmailChips emails={emails} onChange={setEmails} />
}

describe("EmailChips", () => {
  test("a pasted list becomes chips, and what is not an email stays to fix", () => {
    render(<Harness />)
    const box = screen.getByRole("textbox", { name: "Invite teammates" }) as HTMLInputElement
    fireEvent.change(box, { target: { value: "a@kantor.test, b@kantor.test; nope c@kantor.test" } })
    fireEvent.blur(box)
    expect(screen.getAllByRole("row").map((chip) => chip.textContent)).toEqual([
      expect.stringContaining("a@kantor.test"),
      expect.stringContaining("b@kantor.test"),
      expect.stringContaining("c@kantor.test"),
    ])
    expect(box.value).toBe("nope")
    expect(screen.getByText("Not an email address")).toBeTruthy()
  })

  test("email chips", () => {
    render(<Harness />)
    const box = screen.getByRole("textbox", { name: "Invite teammates" }) as HTMLInputElement
    fireEvent.change(box, { target: { value: "a@kantor.test," } })
    expect(screen.getAllByRole("row").map((chip) => chip.textContent)).toEqual([expect.stringContaining("a@kantor.test")])
    expect(box.value).toBe("")
    fireEvent.change(box, { target: { value: "b@kantor.test" } })
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.change(box, { target: { value: "A@kantor.test" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(screen.getAllByRole("row")).toHaveLength(2)
    fireEvent.change(box, { target: { value: "nope" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(screen.getByText("Not an email address")).toBeTruthy()
    expect(box.value).toBe("nope")
    fireEvent.click(screen.getByRole("button", { name: "Remove a@kantor.test" }))
    expect(screen.getAllByRole("row").map((chip) => chip.textContent)).toEqual([expect.stringContaining("b@kantor.test")])
  })
})
