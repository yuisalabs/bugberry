import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProjectForm } from "../src/features/projects/ProjectDialogs"
import { ProjectTile } from "../src/features/projects/ProjectTile"
import { workspaceColor } from "../src/features/workspaces/workspace"

const project = {
  id: "p1",
  workspaceId: "w1",
  name: "quinella AI",
  slug: "quinella-ai",
  urlPatterns: [] as string[],
  logoUrl: null as string | null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
}

describe("ProjectTile", () => {
  test("without a logo: the name's first letter on the project's colour", () => {
    const { container } = render(<ProjectTile project={project} />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile.textContent).toBe("Q")
    expect(tile.className).toContain(workspaceColor("p1"))
  })

  test("with a logo: the logo", () => {
    const { container } = render(<ProjectTile project={{ ...project, logoUrl: "http://localhost/api/project-logos/p1/a.png" }} />)
    expect(container.querySelector("img")?.getAttribute("src")).toBe("http://localhost/api/project-logos/p1/a.png")
  })
})

describe("ProjectForm logo", () => {
  test("the logo is optional: the first letter stands in", () => {
    render(<ProjectForm saving={false} error={null} onSave={mock()} onCancel={mock()} />)
    expect(screen.getByText("Using the first letter for now")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull()
  })

  test("removing the logo in use saves without it", () => {
    const onSave = mock()
    render(
      <ProjectForm
        project={{ ...project, logoUrl: "http://localhost/api/project-logos/p1/a.png" }}
        saving={false}
        error={null}
        onSave={onSave}
        onCancel={mock()}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))
    expect(screen.getByText("Using the first letter for now")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(onSave).toHaveBeenCalledWith({ name: "quinella AI", slug: "quinella-ai", logo: null, removeLogo: true })
  })
})
