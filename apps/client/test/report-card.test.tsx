import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { CardCopyLink, ReportCardBody } from "../src/components/ReportCard"
import { PRIORITY_LABELS, STATUS_LABELS } from "../src/lib/labels"
import { listItemFixture, NOW } from "./fixtures"

describe("ReportCardBody", () => {
  test("shows the thumbnail, reporter, title and relative time", () => {
    render(<ReportCardBody item={listItemFixture()} now={NOW} />)
    const image = screen.getByRole("img", { name: /Pay button/ })
    expect(image.getAttribute("src")).toBe("https://files.test/t.jpg")
    expect(image.getAttribute("loading")).toBe("lazy")
    expect(screen.getByText("Ervalsa Dwi Nanda")).toBeTruthy()
    expect(screen.getByText("17 hours ago")).toBeTruthy()
    expect(screen.getByLabelText("Screenshot")).toBeTruthy()
  })

  test("a video shows its length and No preview without a thumbnail", () => {
    render(<ReportCardBody item={listItemFixture({ captureType: "video", durationMs: 22_000, thumbnailUrl: null })} now={NOW} />)
    expect(screen.getByText("0:22")).toBeTruthy()
    expect(screen.getByText("No preview")).toBeTruthy()
  })

  test("a card shows its status", () => {
    render(<ReportCardBody item={listItemFixture({ status: "in_progress" })} now={NOW} />)
    expect(screen.getByText("In progress")).toBeTruthy()
  })

  test("falls back to No preview when the image fails to load", () => {
    render(<ReportCardBody item={listItemFixture()} now={NOW} />)
    fireEvent.error(screen.getByRole("img", { name: /Pay button/ }))
    expect(screen.getByText("No preview")).toBeTruthy()
  })

  test("a fresh link brings a failed preview back, and a failure asks for fresh links", () => {
    const onPreviewError = mock()
    const { rerender } = render(<ReportCardBody item={listItemFixture()} now={NOW} onPreviewError={onPreviewError} />)
    fireEvent.error(screen.getByRole("img", { name: /Pay button/ }))
    expect(screen.getByText("No preview")).toBeTruthy()
    expect(onPreviewError).toHaveBeenCalledTimes(1)
    rerender(
      <ReportCardBody item={listItemFixture({ thumbnailUrl: "https://files.test/t2.jpg" })} now={NOW} onPreviewError={onPreviewError} />,
    )
    expect(screen.getByRole("img", { name: /Pay button/ }).getAttribute("src")).toBe("https://files.test/t2.jpg")
  })

  test("long titles stay on one truncated line", () => {
    render(<ReportCardBody item={listItemFixture({ title: "x".repeat(200) })} now={NOW} />)
    expect(screen.getByText("x".repeat(200)).className).toContain("truncate")
  })

  test("shows the status, and under the title the project and a priority that is set", () => {
    const { rerender } = render(
      <ReportCardBody item={listItemFixture({ status: "open", priority: "high", assigneeId: "u2" })} now={NOW} projectName="Quinella AI" />,
    )
    expect(screen.getByText(STATUS_LABELS.open)).toBeTruthy()
    expect(screen.getByText("Quinella AI")).toBeTruthy()
    expect(screen.getByText(PRIORITY_LABELS.high)).toBeTruthy()
    // No priority and no project: no line for them.
    rerender(<ReportCardBody item={listItemFixture({ priority: "none" })} now={NOW} />)
    expect(screen.queryByText(PRIORITY_LABELS.none)).toBeNull()
  })
})

describe("CardCopyLink", () => {
  test("copies the report's share link without opening the report", async () => {
    const writeText = mock(async (_text: string) => {})
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const opened = mock()
    render(
      <div onClick={opened}>
        <CardCopyLink item={listItemFixture()} />
      </div>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/s3cret-slug`)
    expect(opened).not.toHaveBeenCalled()
    expect(await screen.findByText("Copied")).toBeTruthy()
  })
})
