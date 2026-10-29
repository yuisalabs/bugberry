import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { NewReportButton } from "../src/features/reports/list/NewReportButton"
import { ReportCardBody } from "../src/features/reports/list/ReportCard"
import { checkedText, ReportsView } from "../src/features/reports/list/ReportsView"
import type { ExtensionAnswer } from "../src/features/onboarding/extension-bridge"
import type { ReportFeed } from "../src/features/reports/list/report-feed"
import { CLEARED_FILTERS } from "../src/features/reports/list/report-search"
import { listItemFixture, NOW } from "./fixtures"

const feed = (total: number): ReportFeed => ({
  items: Array.from({ length: total }, (_, index) => listItemFixture({ id: `r${index}` })),
  total,
  hasMore: false,
  loadingMore: false,
  moreFailed: false,
})

function props(overrides: Partial<ComponentProps<typeof ReportsView>> = {}): ComponentProps<typeof ReportsView> {
  return {
    title: "Quinella AI",
    members: [],
    search: {},
    list: feed(0),
    now: NOW,
    onSearch: mock(),
    onLoadMore: mock(),
    canInvite: false,
    onInvite: mock(),
    newReport: <button type="button">New report</button>,
    layout: "grid",
    onLayout: mock(),
    renderCard: (item) => <ReportCardBody item={item} now={NOW} />,
    ...overrides,
  }
}

describe("an empty report list", () => {
  test("no report yet: the empty jar, the way to record one, and no filters to work on", () => {
    render(<ReportsView {...props({ showCount: true, recordButton: <button type="button">Record your first bug</button> })} />)
    expect(screen.getByRole("heading", { name: "No bugs caught yet" })).toBeTruthy()
    expect(screen.getByText(/^Your jar is still empty\./)).toBeTruthy()
    expect(screen.getByText("your first bug goes in here!")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Record your first bug" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Invite teammates" })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Type/ })).toBeNull()
  })

  test("admins who may invite get Invite teammates there too", () => {
    const onInvite = mock()
    render(<ReportsView {...props({ canInvite: true, onInvite })} />)
    fireEvent.click(screen.getByRole("button", { name: "Invite teammates" }))
    expect(onInvite).toHaveBeenCalled()
  })

  test("filters that leave nothing: how much was searched, the filters kept, and one click to clear them all", () => {
    const onSearch = mock()
    render(<ReportsView {...props({ search: { status: ["open"], q: "pay", sort: "oldest" }, checkedTotal: 128, onSearch })} />)
    expect(screen.getByRole("heading", { name: "No reports match your filters" })).toBeTruthy()
    expect(
      screen.getByText(
        "We checked all 128 reports, but none fit every filter at once. Try loosening one. The bug might be hiding just outside the net.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Type/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }))
    expect(onSearch).toHaveBeenCalledWith(CLEARED_FILTERS)
    // The order is not a filter: clearing leaves it.
    expect(Object.keys(CLEARED_FILTERS)).not.toContain("sort")
  })

  test("the searched count reads naturally, and the line stands without it", () => {
    expect(checkedText(1)).toBe("We checked the only report, but it doesn't fit every filter at once.")
    expect(checkedText(0)).toBe("There are no reports here yet, so there's nothing to match.")
    expect(checkedText(null)).toBe("None of the reports fit every filter at once.")
  })

  test("a project's page counts its reports under the title, without its address", () => {
    const { rerender } = render(<ReportsView {...props({ showCount: true })} />)
    expect(screen.getByText("0 reports")).toBeTruthy()
    expect(screen.queryByText(/\/app\/p\//)).toBeNull()
    rerender(<ReportsView {...props({ showCount: true, list: feed(1) })} />)
    // Under the title, and again in the phone's count row once there are reports.
    expect(screen.getAllByText("1 report").length).toBeGreaterThan(0)
  })

  test("Record your first bug is the New report button under another name", async () => {
    const opened = mock(async () => true)
    const ask = mock(async (): Promise<ExtensionAnswer> => ({ installed: true, active: true, version: "1" }))
    render(<NewReportButton open={opened} ask={ask} installUrl={null} label="Record your first bug" prominent />)
    await waitFor(() => expect(ask).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.click(screen.getByRole("button", { name: "Record your first bug" }))
    await waitFor(() => expect(opened).toHaveBeenCalled())
  })
})
