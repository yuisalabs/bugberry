import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { ReportCardBody } from "../src/features/reports/list/ReportCard"
import { ReportsView } from "../src/features/reports/list/ReportsView"
import { ReportTableBody } from "../src/features/reports/list/ReportTable"
import type { ReportFeed } from "../src/features/reports/list/report-feed"
import { listItemFixture, NOW } from "./fixtures"
import type { ReportListItem } from "../src/features/reports/queries"

const members = [{ id: "u1", name: "Ana", email: "ana@kantor.test", image: null, role: "member" as const, owner: false, joinedAt: new Date("2026-09-12T00:00:00Z") }]

function listOf(items: ReportListItem[], more: Partial<ReportFeed> = {}): ReportFeed {
  return { items, total: items.length, hasMore: false, loadingMore: false, moreFailed: false, ...more }
}

function props(overrides: Partial<ComponentProps<typeof ReportsView>> = {}): ComponentProps<typeof ReportsView> {
  return {
    title: "All reports",
    members,
    search: {},
    list: listOf([]),
    now: NOW,
    onSearch: mock(),
    onLoadMore: mock(),
    canInvite: true,
    onInvite: mock(),
    newReport: <button type="button">New report</button>,
    layout: "grid",
    onLayout: mock(),
    renderCard: (item) => <ReportCardBody item={item} now={NOW} />,
    renderTable: (items, tableProjects) => (
      <ReportTableBody items={items} members={members} projects={tableProjects} now={NOW} rowLink={(item) => item.title} />
    ),
    ...overrides,
  }
}

describe("ReportsView", () => {
  test("lays reports out as cards with the page title", () => {
    render(<ReportsView {...props({ list: listOf([listItemFixture({ id: "a" }), listItemFixture({ id: "b", title: "Second" })]) })} />)
    expect(screen.getByRole("heading", { name: "All reports" })).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByText("Second")).toBeTruthy()
  })

  test("a limited workspace shows its usage in the header", () => {
    const { rerender } = render(<ReportsView {...props({ usage: "3 of 5 screenshots · 0 of 5 recordings" })} />)
    expect(screen.getByText("3 of 5 screenshots · 0 of 5 recordings")).toBeTruthy()
    rerender(<ReportsView {...props()} />)
    expect(screen.queryByText(/of 5 screenshots/)).toBeNull()
  })

  test("the header has search, invite for admins on phones, and new report", () => {
    const onSearch = mock()
    const onInvite = mock()
    const { rerender } = render(<ReportsView {...props({ onSearch, onInvite })} />)
    fireEvent.change(screen.getByRole("searchbox", { name: "Search reports" }), { target: { value: " pay " } })
    fireEvent.submit(screen.getByRole("search"))
    expect(onSearch).toHaveBeenLastCalledWith({ q: "pay" })
    // Only the phone's Invite beside the title; wider screens have it in the app's top bar.
    const invites = screen.getAllByRole("button", { name: "Invite" })
    expect(invites).toHaveLength(1)
    fireEvent.click(invites[0] as HTMLElement)
    expect(onInvite).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "New report" })).toBeTruthy()
    rerender(<ReportsView {...props({ canInvite: false })} />)
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull()
  })

  test("sort menu", () => {
    const onSearch = mock()
    render(<ReportsView {...props({ onSearch, list: listOf([listItemFixture({ id: "a" })]) })} />)
    // The phone's row and the wider screens' filter row each have one; CSS shows one of them.
    const sort = () => screen.getAllByRole("button", { name: "Sort: Newest first" })[0] as HTMLElement
    fireEvent.click(sort())
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest first" }))
    expect(onSearch).toHaveBeenLastCalledWith({ sort: "oldest" })
    fireEvent.click(sort())
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Priority" }))
    expect(onSearch).toHaveBeenLastCalledWith({ sort: "priority" })
  })

  test("the list names each report's project on a project page too", () => {
    const projects = [{ id: "p1", name: "Checkout Web", slug: "checkout", workspaceId: "w1", urlPatterns: [] as string[], logoUrl: null, createdAt: new Date() }]
    render(<ReportsView {...props({ list: listOf([listItemFixture({ projectId: "p1" })]), layout: "list", tableProjects: projects })} />)
    expect(screen.queryByRole("button", { name: /Project/ })).toBeNull()
    expect(screen.getByText("Checkout Web")).toBeTruthy()
  })

  test("grid and list", () => {
    const onLayout = mock()
    const items = [listItemFixture({ id: "a" })]
    const { rerender } = render(<ReportsView {...props({ list: listOf(items), onLayout })} />)
    expect(screen.getByRole("radio", { name: "Grid view" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("radio", { name: "List view" }))
    expect(onLayout).toHaveBeenCalledWith("list")
    rerender(<ReportsView {...props({ list: listOf(items), layout: "list" })} />)
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent)
    expect(headers).toEqual(["", "Report", "Status", "Priority", "Reporter", "Assignee", "Project", "Created"])
  })

  test("explains an empty list and a filtered empty list", () => {
    const { rerender } = render(<ReportsView {...props()} />)
    expect(screen.getByText("No bugs caught yet")).toBeTruthy()
    rerender(<ReportsView {...props({ search: { status: ["open"] } })} />)
    expect(screen.getByText("No reports match your filters")).toBeTruthy()
  })

  test("shows loading and a retryable error", () => {
    const { rerender } = render(<ReportsView {...props({ list: "loading" })} />)
    expect(screen.getByRole("status")).toBeTruthy()
    const retry = mock()
    rerender(<ReportsView {...props({ list: { error: new Error("putus"), retry } })} />)
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  test("no page controls: the list loads more as it scrolls, under the grid and under the table", () => {
    const list = listOf([listItemFixture()], { total: 45, hasMore: true, loadingMore: true })
    const { rerender } = render(<ReportsView {...props({ list })} />)
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull()
    expect(screen.getByRole("status").textContent).toContain("Loading more reports")
    rerender(<ReportsView {...props({ list, layout: "list" })} />)
    expect(screen.getByRole("status").textContent).toContain("Loading more reports")
  })

  test("a part that failed to load offers Try again, which asks for it", () => {
    const onLoadMore = mock()
    render(<ReportsView {...props({ list: listOf([listItemFixture()], { total: 45, hasMore: true, moreFailed: true }), onLoadMore })} />)
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
