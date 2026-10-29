import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { MoreMenuView } from "../src/features/reports/detail/MoreMenu"

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
    onCopyForAi: mock(),
    onSetUpAi: mock(),
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

  test("Copy for AI and its setup live in the menu", () => {
    const props = view()
    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy for AI/ }))
    expect(props.onCopyForAi).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Set up AI agents" }))
    expect(props.onSetUpAi).toHaveBeenCalledTimes(1)
  })

  test("trackers have their own green button beside Copy link, not a place in the menu", () => {
    view({ needsProject: true })
    expect(screen.queryByRole("menuitem", { name: /Send to/ })).toBeNull()
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

describe("MoreMenuView on a phone", () => {
  const phone = () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({ matches: query === "(max-width: 767px)", media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
    return () => {
      window.matchMedia = original
    }
  }

  test("the actions open in a sheet; Move to project is a second step with a way back", () => {
    const restore = phone()
    try {
      const props = view()
      const sheet = () => document.querySelector("[data-slot=sheet]") as HTMLElement
      expect(sheet()).toBeTruthy()
      expect(screen.queryAllByRole("menuitem")).toHaveLength(0)
      fireEvent.click(screen.getByRole("button", { name: /Move to project/ }))
      expect(screen.getByRole("button", { name: "Checkout Web" }).getAttribute("aria-pressed")).toBe("true")
      fireEvent.click(screen.getByRole("button", { name: "Back" }))
      expect(screen.getByRole("button", { name: /Copy for AI/ })).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: /Move to project/ }))
      fireEvent.click(screen.getByRole("button", { name: "Q4 regression" }))
      expect(props.onMove).toHaveBeenCalledWith("p2")
    } finally {
      restore()
    }
  })

  test("each action runs from the sheet; a tracker that cannot be used is disabled", () => {
    const restore = phone()
    try {
      const props = view({ trackers: [], needsProject: true })
      expect((screen.getByRole("button", { name: /Send to a tracker/ }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(screen.getByRole("button", { name: /Copy for AI/ }))
      expect(props.onCopyForAi).toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  test("sending to a tracker, a new project and deleting work from the sheet", () => {
    const restore = phone()
    try {
      const props = view()
      fireEvent.click(screen.getByRole("button", { name: /Send to GitHub/ }))
      expect(props.onSend).toHaveBeenCalledWith("gh")
      fireEvent.click(screen.getByRole("button", { name: "More actions" }))
      fireEvent.click(screen.getByRole("button", { name: /Delete report/ }))
      expect(props.onDelete).toHaveBeenCalled()
      fireEvent.click(screen.getByRole("button", { name: "More actions" }))
      fireEvent.click(screen.getByRole("button", { name: /Move to project/ }))
      fireEvent.click(screen.getByRole("button", { name: /New project/ }))
      expect(props.onNewProject).toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})
