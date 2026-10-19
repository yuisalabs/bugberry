import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { MoreMenuView } from "../src/components/report/MoreMenu"

const projects = [
  { id: "p1", name: "Checkout Web" },
  { id: "p2", name: "Q4 regression" },
]

function view(overrides: Partial<Parameters<typeof MoreMenuView>[0]> = {}) {
  const props = {
    projectId: "p1",
    projects,
    trackers: [{ integrationId: "gh", label: "Send to GitHub · kantor/web", action: "send" as const, href: null, note: null }],
    needsProject: false,
    canDelete: true,
    onMove: mock(),
    onNewProject: mock(),
    onSend: mock(),
    onDelete: mock(),
    ...overrides,
  }
  render(<MoreMenuView {...props} />)
  fireEvent.click(screen.getByRole("button", { name: "More actions" }))
  return props
}

describe("MoreMenuView", () => {
  test("Move to project marks the current project and moves to another", () => {
    const props = view()
    fireEvent.click(screen.getByRole("menuitem", { name: /Move to project/ }))
    expect(screen.getByRole("menuitemradio", { name: "Checkout Web" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Q4 regression" }))
    expect(props.onMove).toHaveBeenCalledWith("p2")
  })

  test("a report can leave its project, or go to a new one", () => {
    const props = view()
    fireEvent.click(screen.getByRole("menuitem", { name: /Move to project/ }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No project" }))
    expect(props.onMove).toHaveBeenCalledWith(null)
  })

  test("tracker items send", () => {
    const props = view()
    fireEvent.click(screen.getByRole("menuitem", { name: "Send to GitHub · kantor/web" }))
    expect(props.onSend).toHaveBeenCalledWith("gh")
  })

  test("Delete is for admins only", () => {
    const props = view()
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete report" }))
    expect(props.onDelete).toHaveBeenCalledTimes(1)
  })

  test("members see no Delete", () => {
    view({ canDelete: false })
    expect(screen.queryByRole("menuitem", { name: "Delete report" })).toBeNull()
  })
})
