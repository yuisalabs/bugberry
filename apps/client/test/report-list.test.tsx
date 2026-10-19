import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ReportFilters } from "../src/components/ReportFilters"
import { ReportSearchBox } from "../src/components/ReportSearchBox"
import { STATUS_LABELS } from "../src/lib/labels"
import { choose } from "./fields"

const members = [{ id: "u1", name: "Ana", email: "ana@kantor.test", image: null, role: "member" as const, owner: false }]

const projects = [{ id: "p1", name: "Checkout Web", slug: "checkout", workspaceId: "w1", urlPatterns: [] as string[], createdAt: new Date() }]

/** React Aria presses fire on pointer events; a plain click is enough for happy-dom. */
function press(element: HTMLElement) {
  fireEvent.click(element)
}

describe("ReportFilters", () => {
  test("chooses a capture type, statuses and a reporter", () => {
    const onChange = mock()
    render(<ReportFilters search={{}} members={members} onChange={onChange} />)
    press(screen.getByRole("button", { name: /Type/ }))
    press(screen.getByRole("menuitemradio", { name: "Video" }))
    expect(onChange).toHaveBeenLastCalledWith({ captureType: "video" })
    press(screen.getByRole("button", { name: /Status/ }))
    press(screen.getByRole("menuitemcheckbox", { name: STATUS_LABELS.open }))
    expect(onChange).toHaveBeenLastCalledWith({ status: ["open"] })
    press(screen.getByRole("button", { name: /Reporter/ }))
    press(screen.getByRole("menuitemradio", { name: "Ana" }))
    expect(onChange).toHaveBeenLastCalledWith({ reporterId: "u1" })
  })

  test("in a pick-one or pick-many menu every label lines up: the chosen item's check and the others' blank take the same first column", () => {
    render(<ReportFilters search={{}} members={members} onChange={mock()} />)
    press(screen.getByRole("button", { name: /Type/ }))
    const items = screen.getAllByRole("menuitemradio")
    expect(items.map((item) => item.textContent)).toEqual(["All", "Screenshot", "Video"])
    for (const item of items) {
      const first = item.firstElementChild
      expect(first?.getAttribute("data-slot")).toBe("check-indicator")
      expect(first?.getAttribute("class")).toContain("size-4")
    }
    // The chosen one draws the check; the others keep the room blank.
    expect(items[0]?.firstElementChild?.tagName.toLowerCase()).toBe("svg")
    expect(items[1]?.firstElementChild?.tagName.toLowerCase()).toBe("span")
  })

  test("priority and assignee live under More filters", () => {
    const onChange = mock()
    render(<ReportFilters search={{}} members={members} onChange={onChange} />)
    expect(screen.queryByRole("toolbar", { name: "Priority" })).toBeNull()
    press(screen.getByRole("button", { name: "More filters" }))
    expect(screen.getByRole("toolbar", { name: "Priority" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "High" }))
    expect(onChange).toHaveBeenLastCalledWith({ priority: ["high"] })
    choose("Assignee", "Ana")
    expect(onChange).toHaveBeenLastCalledWith({ assigneeId: "u1" })
    expect(screen.queryByRole("combobox", { name: "Sort" })).toBeNull()
  })

  test("the project filter appears only when projects are given, with a no-project choice", () => {
    const onChange = mock()
    const { rerender } = render(<ReportFilters search={{}} members={members} onChange={onChange} />)
    expect(screen.queryByRole("button", { name: /Project/ })).toBeNull()
    rerender(<ReportFilters search={{}} members={members} projects={projects} onChange={onChange} />)
    press(screen.getByRole("button", { name: /Project/ }))
    press(screen.getByRole("menuitemradio", { name: "No project" }))
    expect(onChange).toHaveBeenLastCalledWith({ projectId: "none" })
  })

  test("the project button says a project is chosen even before the list has its name", () => {
    const { rerender } = render(
      <ReportFilters search={{ projectId: "p1" }} members={members} projects={[]} projectsLoading onChange={mock()} />,
    )
    expect(screen.getByRole("button", { name: /Project: Loading/ })).toBeTruthy()
    rerender(<ReportFilters search={{ projectId: "p9" }} members={members} projects={projects} onChange={mock()} />)
    expect(screen.getByRole("button", { name: /Project: not found/ })).toBeTruthy()
  })

  test("submits trimmed search text", () => {
    const onChange = mock()
    render(<ReportSearchBox value={undefined} onSearch={(q) => onChange({ q })} />)
    fireEvent.change(screen.getByRole("searchbox", { name: "Search reports" }), { target: { value: "  checkout " } })
    fireEvent.submit(screen.getByRole("search"))
    expect(onChange).toHaveBeenLastCalledWith({ q: "checkout" })
  })

  test("Ctrl K focuses the search box and is not typed", () => {
    render(
      <>
        <input aria-label="Lain" />
        <ReportSearchBox value={undefined} onSearch={mock()} />
      </>,
    )
    const other = screen.getByLabelText("Lain")
    other.focus()
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })
    other.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search reports" }))
  })

  test("clears every filter but keeps the order", () => {
    const onChange = mock()
    render(
      <ReportFilters search={{ status: ["open"], captureType: "video", sort: "priority" }} members={members} onChange={onChange} />,
    )
    press(screen.getByRole("button", { name: "Clear filters" }))
    expect(onChange).toHaveBeenLastCalledWith({
      status: undefined,
      priority: undefined,
      assigneeId: undefined,
      reporterId: undefined,
      captureType: undefined,
      projectId: undefined,
      q: undefined,
    })
  })
})
