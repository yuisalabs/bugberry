import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { JoinWorkspaceBody } from "../src/components/JoinWorkspaceDialog"
import { WorkspaceMenuPanel } from "../src/components/WorkspaceMenu"
import { workspaceColor } from "../src/lib/workspace"

const workspaces = [
  { id: "w1", name: "Cuy Workspaces", role: "admin" as const, owner: true, slug: "cuy-workspaces", logoUrl: null },
  { id: "w2", name: "Yuisa Labs", role: "member" as const, owner: false, slug: "yuisa-labs", logoUrl: null },
  { id: "w3", name: "Northwind Commerce", role: "admin" as const, owner: false, slug: "northwind-commerce", logoUrl: null },
]
const me = { name: "Ervalsa Dwi Nanda", email: "ervalsa@javan.co.id", image: null }

const panel = () => {
  const props = { onSwitch: mock(), onCreate: mock(), onJoin: mock(), onAccount: mock(), onAiAgents: mock(), onLogout: mock() }
  render(<WorkspaceMenuPanel workspaces={workspaces} currentId="w1" me={me} {...props} />)
  return props
}

describe("WorkspaceMenuPanel", () => {
  test("the menu finds, lists and switches workspaces", () => {
    const props = panel()
    expect(screen.getByText("Workspaces")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
    const rows = screen.getAllByRole("menuitemradio")
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Cuy WorkspacesOwner"),
      expect.stringContaining("Yuisa LabsMember"),
      expect.stringContaining("Northwind CommerceAdmin"),
    ])
    expect(rows[0]?.getAttribute("aria-checked")).toBe("true")

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a workspace" }), { target: { value: "nor" } })
    expect(screen.getAllByRole("menuitemradio").map((row) => row.textContent)).toEqual([expect.stringContaining("Northwind")])
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Northwind/ }))
    expect(props.onSwitch).toHaveBeenCalledWith("w3")
  })

  test("Create and Join workspace", () => {
    const props = panel()
    fireEvent.click(screen.getByRole("menuitem", { name: "Create workspace" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Join workspace" }))
    expect(props.onCreate).toHaveBeenCalled()
    expect(props.onJoin).toHaveBeenCalled()
  })

  test("without onCreate there is no Create workspace, only Join", () => {
    render(
      <WorkspaceMenuPanel workspaces={workspaces} currentId="w1" me={me} onSwitch={mock()} onJoin={mock()} onAccount={mock()} onAiAgents={mock()} onLogout={mock()} />,
    )
    expect(screen.queryByRole("menuitem", { name: "Create workspace" })).toBeNull()
    expect(screen.getByRole("menuitem", { name: "Join workspace" })).toBeTruthy()
  })

  test("the account part of the menu", () => {
    const props = panel()
    expect(screen.getByText("Ervalsa Dwi Nanda")).toBeTruthy()
    expect(screen.getByText("ervalsa@javan.co.id")).toBeTruthy()
    fireEvent.click(screen.getByRole("menuitem", { name: "Account settings" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "AI agents (MCP)" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }))
    expect(props.onAccount).toHaveBeenCalled()
    expect(props.onAiAgents).toHaveBeenCalled()
    expect(props.onLogout).toHaveBeenCalled()
  })

  test("each workspace keeps its colour", () => {
    expect(workspaceColor("w1")).toBe(workspaceColor("w1"))
    const colours = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(workspaceColor))
    expect(colours.size).toBeGreaterThan(1)
  })
})

describe("JoinWorkspaceBody", () => {
  test("pending invitations still show", () => {
    const onJoinInvitation = mock()
    render(
      <JoinWorkspaceBody
        invitations={[{ id: "i1", workspaceName: "Javan Studio", inviterName: "Priya" }]}
        domainWorkspaces={[]}
        preview={{ status: "idle" }}
        busy={false}
        onValue={mock()}
        onJoinCode={mock()}
        onJoinInvitation={onJoinInvitation}
        onDomain={mock()}
        onCancelRequest={mock()}
      />,
    )
    const row = screen.getByText(/Javan Studio/).closest("li") as HTMLElement
    expect(row.textContent).toContain("Invited by Priya")
    fireEvent.click(within(row).getByRole("button", { name: "Join Javan Studio" }))
    expect(onJoinInvitation).toHaveBeenCalledWith("i1")
  })
})

describe("WorkspaceTile", () => {
  test("a workspace with a logo shows it in the menu", () => {
    render(
      <WorkspaceMenuPanel
        workspaces={[{ id: "w1", name: "Javan QA", role: "admin", owner: true, logoUrl: "http://localhost:3000/api/workspace-logos/w1/a.png" }]}
        currentId="w1"
        me={me}
        onSwitch={mock()}
        onCreate={mock()}
        onJoin={mock()}
        onAccount={mock()}
        onAiAgents={mock()}
        onLogout={mock()}
      />,
    )
    const row = screen.getByRole("menuitemradio", { name: /Javan QA/ })
    expect(row.querySelector("img")?.getAttribute("src")).toBe("http://localhost:3000/api/workspace-logos/w1/a.png")
  })
})
