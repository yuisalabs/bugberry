import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProjectsMenuPanel } from "../src/components/ProjectsMenu"

const projects = [
  { id: "p1", name: "Quinella AI", slug: "quinella-ai" },
  { id: "p2", name: "Test nama project", slug: "test-nama-project" },
  { id: "p3", name: "hanna-project", slug: "hanna-project" },
]

describe("ProjectsMenuPanel", () => {
  test("finds, lists and opens projects, ticking the open one", () => {
    const onOpen = mock()
    render(<ProjectsMenuPanel projects={projects} currentSlug="test-nama-project" onOpen={onOpen} />)
    expect(screen.getByText("3")).toBeTruthy()
    // Each row starts with the project's tile: its first letter while it has no logo.
    const rows = screen.getAllByRole("menuitemradio")
    expect(rows.map((row) => row.textContent)).toEqual(["QQuinella AI", "TTest nama project", "Hhanna-project"])
    expect(rows[1]?.getAttribute("aria-checked")).toBe("true")

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a project" }), { target: { value: "hann" } })
    expect(screen.getAllByRole("menuitemradio").map((row) => row.textContent)).toEqual(["Hhanna-project"])
    fireEvent.click(screen.getByRole("menuitemradio", { name: "hanna-project" }))
    expect(onOpen).toHaveBeenCalledWith("hanna-project")
  })

  test("a search that finds nothing says so", () => {
    render(<ProjectsMenuPanel projects={projects} onOpen={mock()} />)
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a project" }), { target: { value: "zzz" } })
    expect(screen.getByText("No project has that name")).toBeTruthy()
  })

  test("only admins get Manage projects", () => {
    const onManage = mock()
    const { unmount } = render(<ProjectsMenuPanel projects={projects} onOpen={mock()} onManage={onManage} />)
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage projects" }))
    expect(onManage).toHaveBeenCalled()
    unmount()
    render(<ProjectsMenuPanel projects={projects} onOpen={mock()} />)
    expect(screen.queryByRole("menuitem", { name: "Manage projects" })).toBeNull()
  })
})
