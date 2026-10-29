import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { AccountMenuPanel } from "../src/features/account/AccountMenu"
import { JoinWorkspaceBody } from "../src/features/workspaces/JoinWorkspaceDialog"
import { WorkspaceMenuPanel } from "../src/features/workspaces/WorkspaceMenu"
import { workspaceColor } from "../src/features/workspaces/workspace"

const workspaces = [
  { id: "w1", name: "Cuy Workspaces", role: "admin" as const, owner: true, slug: "cuy-workspaces", logoUrl: null },
  { id: "w2", name: "Yuisa Labs", role: "member" as const, owner: false, slug: "yuisa-labs", logoUrl: null },
  { id: "w3", name: "Northwind Commerce", role: "admin" as const, owner: false, slug: "northwind-commerce", logoUrl: null },
]
const me = { name: "Ervalsa Dwi Nanda", email: "ervalsa@javan.co.id", image: null }

const panel = () => {
  const props = { onSwitch: mock(), onCreate: mock(), onJoin: mock(), onSettings: mock(), onInvite: mock() }
  render(<WorkspaceMenuPanel workspaces={workspaces} currentId="w1" {...props} />)
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
      <WorkspaceMenuPanel workspaces={workspaces} currentId="w1" onSwitch={mock()} onJoin={mock()} />,
    )
    expect(screen.queryByRole("menuitem", { name: "Create workspace" })).toBeNull()
    expect(screen.getByRole("menuitem", { name: "Join workspace" })).toBeTruthy()
  })

  test("admins get Workspace settings and Invite members", () => {
    const props = panel()
    fireEvent.click(screen.getByRole("menuitem", { name: "Workspace settings" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Invite members" }))
    expect(props.onSettings).toHaveBeenCalled()
    expect(props.onInvite).toHaveBeenCalled()
  })

  test("members get neither", () => {
    render(<WorkspaceMenuPanel workspaces={workspaces} currentId="w2" onSwitch={mock()} onJoin={mock()} />)
    expect(screen.queryByRole("menuitem", { name: "Workspace settings" })).toBeNull()
    expect(screen.queryByRole("menuitem", { name: "Invite members" })).toBeNull()
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
        onSwitch={mock()}
        onCreate={mock()}
        onJoin={mock()}
      />,
    )
    const row = screen.getByRole("menuitemradio", { name: /Javan QA/ })
    expect(row.querySelector("img")?.getAttribute("src")).toBe("http://localhost:3000/api/workspace-logos/w1/a.png")
  })
})

describe("AccountMenuPanel", () => {
  test("who is signed in, Account settings and Log out", () => {
    const onAccount = mock()
    const onLogout = mock()
    render(<AccountMenuPanel me={me} extension={{ installed: false }} onAccount={onAccount} onLogout={onLogout} />)
    expect(screen.getByText("Ervalsa Dwi Nanda")).toBeTruthy()
    expect(screen.getByText("ervalsa@javan.co.id")).toBeTruthy()
    fireEvent.click(screen.getByRole("menuitem", { name: "Account settings" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }))
    expect(onAccount).toHaveBeenCalled()
    expect(onLogout).toHaveBeenCalled()
  })

  test("the extension's version shows once it is installed", () => {
    render(
      <AccountMenuPanel me={me} extension={{ installed: true, active: true, version: "0.2.3" }} onAccount={mock()} onLogout={mock()} />,
    )
    expect(screen.getByRole("menuitem", { name: /Browser extension/ }).textContent).toContain("v0.2.3")
  })

  test("Help & docs opens the docs", () => {
    render(<AccountMenuPanel me={me} extension={{ installed: false }} onAccount={mock()} onLogout={mock()} />)
    expect(screen.getByRole("menuitem", { name: /Help & docs/ }).getAttribute("href")).toContain("/docs")
  })
})
