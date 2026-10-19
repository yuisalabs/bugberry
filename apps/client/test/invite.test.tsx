import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { inviteView } from "../src/lib/invite"
import { InviteView } from "../src/pages/InvitePage"

const info = { workspaceName: "PT Maju", email: "sari@ptmaju.com", inviterName: "Budi", status: "pending" as const }

describe("inviteView", () => {
  test("each state", () => {
    expect(inviteView(info, null)).toBe("sign-in")
    expect(inviteView(info, { email: "Sari@PTMaju.com" })).toBe("join")
    expect(inviteView(info, { email: "sari@gmail.com" })).toBe("wrong-account")
    expect(inviteView({ ...info, status: "expired" }, { email: "sari@ptmaju.com" })).toBe("unavailable")
    expect(inviteView({ ...info, status: "accepted" }, null)).toBe("unavailable")
    expect(inviteView("not_found", null)).toBe("unavailable")
  })
})

describe("InviteView", () => {
  const props = { token: "tok", info, meEmail: null, onJoin: mock(), onSignOut: mock() }

  test("signed out: who invited you, and a sign-in that comes back here", () => {
    render(<InviteView {...props} />)
    expect(screen.getByRole("heading", { name: "Budi invited you to PT Maju" })).toBeTruthy()
    expect(screen.getByText("Sign in as sari@ptmaju.com to join.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login?next=%2Finvite%2Ftok")
  })

  test("signed in with the invited address: join", () => {
    const onJoin = mock()
    render(<InviteView {...props} meEmail="sari@ptmaju.com" onJoin={onJoin} />)
    fireEvent.click(screen.getByRole("button", { name: "Join PT Maju" }))
    expect(onJoin).toHaveBeenCalled()
  })

  test("signed in as someone else: say so and offer to sign out", () => {
    const onSignOut = mock()
    render(<InviteView {...props} meEmail="sari@gmail.com" onSignOut={onSignOut} />)
    expect(screen.getByText("This invite is for sari@ptmaju.com; you're signed in as sari@gmail.com.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(onSignOut).toHaveBeenCalled()
  })

  test("expired or withdrawn", () => {
    render(<InviteView {...props} info={{ ...info, status: "revoked" }} />)
    expect(screen.getByText("This invite has expired or was withdrawn. Ask for a new one.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Go to BugBerry" }).getAttribute("href")).toBe("/app")
  })
})
