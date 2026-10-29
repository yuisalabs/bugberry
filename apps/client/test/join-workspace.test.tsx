import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { JoinWorkspaceBody } from "../src/features/workspaces/JoinWorkspaceDialog"
import { JoinView } from "../src/features/workspaces/JoinPage"

const ws = (id: string, name: string, memberCount = 3) => ({ id, name, logoUrl: null, memberCount })

function body(overrides: Partial<Parameters<typeof JoinWorkspaceBody>[0]> = {}) {
  const props = {
    invitations: [],
    domainWorkspaces: [],
    preview: { status: "idle" as const },
    busy: false,
    onValue: mock(),
    onJoinCode: mock(),
    onJoinInvitation: mock(),
    onDomain: mock(),
    onCancelRequest: mock(),
    ...overrides,
  }
  render(<JoinWorkspaceBody {...props} />)
  return props
}

describe("JoinWorkspaceBody", () => {
  test("a pasted code shows the workspace and joins it", () => {
    const props = body({
      preview: {
        status: "found",
        data: { workspace: ws("w1", "Yuisa Labs", 12), via: "invitation", inviterName: "Priya Raman", alreadyMember: false },
      },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Invite link or code" }), { target: { value: "7KX-29QF" } })
    expect(props.onValue).toHaveBeenCalledWith("7KX-29QF")
    const card = screen.getByRole("region", { name: "Yuisa Labs" })
    expect(card.textContent).toContain("Invited by Priya Raman · 12 members")
    expect(card.textContent).toContain("Member")
    fireEvent.click(screen.getByRole("button", { name: "Join Yuisa Labs" }))
    expect(props.onJoinCode).toHaveBeenCalled()
  })

  test("a shared link says so", () => {
    body({ preview: { status: "found", data: { workspace: ws("w1", "Javan QA", 4), via: "shared", inviterName: null, alreadyMember: false } } })
    expect(screen.getByText("Shared invite · 4 members")).toBeTruthy()
  })

  test("an invalid code says so", () => {
    body({ preview: { status: "invalid" } })
    expect(screen.getByText("This link or code doesn't work")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Join / })).toBeNull()
  })

  test("email domain workspaces: Join, Request, Requested", () => {
    const props = body({
      domainWorkspaces: [
        { workspace: ws("w2", "Javan Studio"), mode: "direct", requested: false },
        { workspace: ws("w3", "ActiveCollab QA"), mode: "approval", requested: false },
        { workspace: ws("w4", "Northwind"), mode: "approval", requested: true },
      ],
      domain: "javan.co.id",
    })
    expect(screen.getByText("or join with your email domain")).toBeTruthy()
    const direct = screen.getByText("Javan Studio").closest("li") as HTMLElement
    expect(direct.textContent).toContain("Anyone with @javan.co.id can join")
    fireEvent.click(within(direct).getByRole("button", { name: "Join" }))
    expect(props.onDomain).toHaveBeenCalledWith("w2")
    const approval = screen.getByText("ActiveCollab QA").closest("li") as HTMLElement
    expect(approval.textContent).toContain("Needs approval from an admin")
    fireEvent.click(within(approval).getByRole("button", { name: "Request" }))
    expect(props.onDomain).toHaveBeenCalledWith("w3")
    const requested = screen.getByText("Northwind").closest("li") as HTMLElement
    expect(requested.textContent).toContain("Requested")
    fireEvent.click(within(requested).getByRole("button", { name: "Cancel request" }))
    expect(props.onCancelRequest).toHaveBeenCalledWith("w4")
  })

  test("no domain matches, no domain section", () => {
    body()
    expect(screen.queryByText("or join with your email domain")).toBeNull()
  })
})

describe("JoinView", () => {
  test("the shared link page: sign in first, then join, or say it doesn't work", () => {
    const onJoin = mock()
    const { rerender } = render(<JoinView code="7KX-29QF" signedIn={false} preview={null} onJoin={onJoin} />)
    expect(screen.getByRole("link", { name: "Sign in to join" }).getAttribute("href")).toBe("/login?next=%2Fjoin%2F7KX-29QF")
    rerender(<JoinView code="7KX-29QF" signedIn preview="invalid" onJoin={onJoin} />)
    expect(screen.getByText("This link or code doesn't work")).toBeTruthy()
    rerender(
      <JoinView
        code="7KX-29QF"
        signedIn
        preview={{ workspace: ws("w1", "Javan QA", 4), via: "shared", inviterName: null, alreadyMember: false }}
        onJoin={onJoin}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Join Javan QA" }))
    expect(onJoin).toHaveBeenCalled()
  })
})
