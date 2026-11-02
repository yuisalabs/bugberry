import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { FixedInRow } from "../src/features/reports/detail/FixedInRow"
import type { ReportFix } from "../src/features/reports/queries"

const fix = (id: string, url: string, label: string, provider: ReportFix["provider"]): ReportFix => ({
  id,
  url,
  label,
  provider,
  addedById: "u1",
  viaAgent: null,
  createdAt: new Date("2026-11-02T08:00:00Z"),
})

const FIXES = [
  fix("f1", "https://github.com/shop/web/pull/42", "PR #42 · shop/web", "github"),
  fix("f2", "https://ci.example.com/build/1", "ci.example.com/build/1", "other"),
]

describe("FixedInRow", () => {
  test("lists links that open in a new tab, and removes one", () => {
    const onRemove = mock()
    render(<FixedInRow fixes={FIXES} onAdd={() => {}} onRemove={onRemove} />)
    const link = screen.getByRole("link", { name: "PR #42 · shop/web" })
    expect(link.getAttribute("href")).toBe("https://github.com/shop/web/pull/42")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
    expect(screen.getByRole("link", { name: "ci.example.com/build/1" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Remove PR #42 · shop/web" }))
    expect(onRemove).toHaveBeenCalledWith("f1")
  })

  test("Add link shows a URL field and saves on Enter", () => {
    const onAdd = mock()
    render(<FixedInRow fixes={[]} onAdd={onAdd} onRemove={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "Add fix link" }))
    const field = screen.getByLabelText("Fix link URL")
    fireEvent.change(field, { target: { value: " https://github.com/o/r/pull/9 " } })
    fireEvent.submit(field.closest("form") as HTMLFormElement)
    expect(onAdd).toHaveBeenCalledWith("https://github.com/o/r/pull/9")
  })

  test("shows the server's error under the field", () => {
    render(<FixedInRow fixes={[]} onAdd={() => {}} onRemove={() => {}} adding error="Enter an http or https link" />)
    expect(screen.getByText("Enter an http or https link")).toBeTruthy()
  })

  test("without links and without a way to add, it shows nothing", () => {
    const { container } = render(<FixedInRow fixes={[]} />)
    expect(container.textContent).toBe("")
  })
})
