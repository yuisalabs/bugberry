import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { activeFilterCount, FiltersSheetContent, StatusChips } from "../src/features/reports/list/MobileReportFilters"
import { CLEARED_FILTERS } from "../src/features/reports/list/report-search"

const counts = { total: 9, byStatus: { open: 6, in_progress: 1, resolved: 2, closed: 0 } }
const members = [
  { id: "u1", name: "Yuisa Labs", email: "y@x.test", image: null, role: "admin" as const, owner: false, joinedAt: new Date("2026-09-12T00:00:00Z") },
  { id: "u2", name: "Ers G Four", email: "e@x.test", image: null, role: "member" as const, owner: false, joinedAt: new Date("2026-10-03T00:00:00Z") },
]
const projects = [{ id: "p1", name: "Quinella AI", slug: "quinella-ai", workspaceId: "w1", urlPatterns: [] as string[], logoUrl: null, createdAt: new Date() }]

describe("the phone's report filters", () => {
  test("the Filters badge counts the kinds of filter that are on", () => {
    expect(activeFilterCount({})).toBe(0)
    expect(activeFilterCount({ status: ["open"], projectId: "p1", q: "pay", sort: "oldest" })).toBe(2)
  })

  test("status chips show each status's count and pick one at a time", () => {
    const onChange = mock()
    const { rerender } = render(<StatusChips search={{}} counts={counts} onChange={onChange} />)
    const chips = within(screen.getByRole("group", { name: "Status" })).getAllByRole("button")
    expect(chips.map((chip) => chip.textContent)).toEqual(["All9", "Open6", "In progress1", "Resolved2", "Closed0"])
    expect(chips[0]?.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: /^Open/ }))
    expect(onChange).toHaveBeenLastCalledWith({ status: ["open"] })

    rerender(<StatusChips search={{ status: ["open"] }} counts={counts} onChange={onChange} />)
    expect(screen.getByRole("button", { name: /^Open/ }).getAttribute("aria-pressed")).toBe("true")
    // Picking the chosen one again goes back to all.
    fireEvent.click(screen.getByRole("button", { name: /^Open/ }))
    expect(onChange).toHaveBeenLastCalledWith({ status: undefined })
  })

  test("the sheet's chips set each filter, Reset clears them, and Show reports or X closes", () => {
    const onChange = mock()
    const onDone = mock()
    render(<FiltersSheetContent search={{ status: ["open"] }} members={members} projects={projects} onChange={onChange} onDone={onDone} />)
    expect(screen.getByRole("button", { name: "Open" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Video" }))
    expect(onChange).toHaveBeenLastCalledWith({ captureType: "video" })
    fireEvent.click(screen.getByRole("button", { name: "Resolved" }))
    expect(onChange).toHaveBeenLastCalledWith({ status: ["open", "resolved"] })
    fireEvent.click(screen.getByRole("button", { name: /Ers G Four/ }))
    expect(onChange).toHaveBeenLastCalledWith({ reporterId: "u2" })
    fireEvent.click(screen.getByRole("button", { name: "Quinella AI" }))
    expect(onChange).toHaveBeenLastCalledWith({ projectId: "p1" })
    fireEvent.click(screen.getByRole("button", { name: "High" }))
    expect(onChange).toHaveBeenLastCalledWith({ priority: ["high"] })
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect(onChange).toHaveBeenLastCalledWith(CLEARED_FILTERS)
    fireEvent.click(screen.getByRole("button", { name: "Show reports" }))
    expect(onDone).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onDone).toHaveBeenCalledTimes(2)
  })

  test("a project page's sheet has no project filter", () => {
    render(<FiltersSheetContent search={{}} members={members} onChange={mock()} onDone={mock()} />)
    expect(screen.queryByRole("heading", { name: "Project" })).toBeNull()
  })
})
