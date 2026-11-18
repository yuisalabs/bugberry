import { expect, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { ReportDescription } from "../src/features/reports/detail/ReportDescription"
import { ReportVideoContext } from "../src/features/reports/detail/video-context"

test("a Write with AI description shows headings and numbered steps", () => {
  render(<ReportDescription description={"## Steps to reproduce\n1. Open `/cart`\n2. Click **Pay**\n## Expected\nAn order."} />)
  expect(screen.getByRole("heading", { name: "Steps to reproduce" })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Expected" })).toBeTruthy()
  expect(screen.getAllByRole("listitem")).toHaveLength(2)
  expect(screen.queryByText(/##/)).toBeNull()
})

test("plain text keeps its line breaks and its muted colour", () => {
  const { container } = render(<ReportDescription description={"baris satu\nbaris dua"} />)
  expect(container.querySelectorAll("br")).toHaveLength(1)
  expect(container.firstElementChild?.className).toContain("text-muted-foreground")
  expect(container.firstElementChild?.className).not.toContain("whitespace-pre-wrap")
})

test("a time in a description stays text, also on a video report", () => {
  render(
    <ReportVideoContext.Provider value={{ seek: () => {}, durationMs: 116_000 }}>
      <ReportDescription description="Fails at 0:52" />
    </ReportVideoContext.Provider>,
  )
  expect(screen.queryByRole("button")).toBeNull()
})
