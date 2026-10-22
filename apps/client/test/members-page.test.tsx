import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { sendLabel } from "../src/components/InviteDialog"
import { inviteMeta, MembersView, membersSummary } from "../src/pages/settings/MembersPage"
import { choose } from "./fields"

const members = [
  { id: "u1", name: "Budi", email: "budi@kantor.test", image: null, role: "admin" as const, owner: false, joinedAt: new Date("2026-09-12T00:00:00Z") },
  { id: "u2", name: "Sari", email: "sari@kantor.test", image: null, role: "member" as const, owner: false, joinedAt: new Date("2026-09-12T00:00:00Z") },
]
const pending = [
  {
    id: "i1",
    email: "andi@gmail.com",
    invitedBy: "Budi",
    role: "member" as const,
    sentAt: new Date("2026-10-17T00:00:00Z"),
    expiresAt: new Date("2026-10-24T00:00:00Z"),
  },
]

function view(overrides: Partial<Parameters<typeof MembersView>[0]> = {}) {
  const props = {
    meId: "u1",
    isAdmin: true,
    members,
    invitations: pending,
    onInvite: mock(async () => [
      { email: "a@kantor.test", status: "sent" as const },
      { email: "sari@kantor.test", status: "member" as const },
      { email: "andi@gmail.com", status: "pending" as const },
      { email: "eve@x.test", status: "not_allowed" as const },
    ]),
    onSetRole: mock(),
    onRemove: mock(),
    onRevoke: mock(),
    onResend: mock(),
    ...overrides,
  }
  render(<MembersView {...props} />)
  return props
}

describe("MembersView", () => {
  test("sends invites and labels each result", async () => {
    const props = view()
    // A pasted list, one address per line or with commas, becomes chips.
    fireEvent.paste(screen.getByRole("textbox", { name: "Invite by email" }), {
      clipboardData: { getData: () => "a@kantor.test, sari@kantor.test\nandi@gmail.com\neve@x.test" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send 4 invites" }))
    expect(props.onInvite).toHaveBeenCalledWith(["a@kantor.test", "sari@kantor.test", "andi@gmail.com", "eve@x.test"], "member")
    await waitFor(() => expect(screen.getByText("a@kantor.test: Invited")).toBeTruthy())
    expect(screen.getByText("sari@kantor.test: Already a member")).toBeTruthy()
    expect(screen.getByText("andi@gmail.com: Already invited")).toBeTruthy()
    expect(screen.getByText("eve@x.test: Not allowed on this server")).toBeTruthy()
  })

  test("invites can join as admin", async () => {
    const props = view()
    fireEvent.paste(screen.getByRole("textbox", { name: "Invite by email" }), { clipboardData: { getData: () => "a@kantor.test, b@kantor.test" } })
    choose("Invite as", "Admin")
    fireEvent.click(screen.getByRole("button", { name: "Send 2 invites" }))
    expect(props.onInvite).toHaveBeenCalledWith(["a@kantor.test", "b@kantor.test"], "admin")
    await waitFor(() => expect(screen.getByText("a@kantor.test: Invited")).toBeTruthy())
  })

  test("a pending invite says when it went out, and when it ends once that is near", () => {
    const now = new Date("2026-10-22T00:00:00Z").getTime()
    expect(inviteMeta({ sentAt: new Date(now - 2 * 86_400_000), expiresAt: new Date(now + 5 * 86_400_000) }, now)).toBe("Sent 2d ago")
    expect(inviteMeta({ sentAt: new Date(now - 5 * 86_400_000), expiresAt: new Date(now + 2 * 86_400_000) }, now)).toBe(
      "Sent 5d ago · expires in 2 days",
    )
    expect(inviteMeta({ sentAt: new Date(now - 6 * 86_400_000), expiresAt: new Date(now + 3_600_000) }, now)).toBe("Sent 6d ago · expires today")
  })

  test("pending invitations can be resent or revoked", () => {
    const props = view()
    expect(screen.getByRole("heading", { name: /Pending invites/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Resend andi@gmail.com" }))
    fireEvent.click(screen.getByRole("button", { name: "Revoke andi@gmail.com" }))
    expect(props.onResend).toHaveBeenCalledWith("i1")
    expect(props.onRevoke).toHaveBeenCalledWith("i1")
  })

  test("admins change roles and remove others; everyone can leave", () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: "More for Sari" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Make admin" }))
    expect(props.onSetRole).toHaveBeenCalledWith("u2", "admin")
    // Nobody changes their own role: Budi (me, an admin) has no menu.
    expect(screen.queryByRole("button", { name: "More for Budi" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "More for Sari" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from workspace" }))
    expect(props.onRemove).toHaveBeenCalledWith("u2")
    fireEvent.click(screen.getByRole("button", { name: "Leave workspace" }))
    expect(props.onRemove).toHaveBeenCalledWith("u1")
  })

  test("members see the list without admin controls", () => {
    view({ meId: "u2", isAdmin: false, invitations: [] })
    expect(screen.queryByRole("textbox", { name: "Invite by email" })).toBeNull()
    expect(screen.queryByRole("button", { name: "More for Budi" })).toBeNull()
    expect(screen.getByRole("button", { name: "Leave workspace" })).toBeTruthy()
  })
})

describe("MembersView owner", () => {
  test("Members shows the owner and protects them", () => {
    view({
      meId: "u2",
      members: [
        { id: "u1", name: "Budi", email: "budi@kantor.test", image: null, role: "admin", owner: true, joinedAt: new Date("2026-09-12T00:00:00Z") },
        { id: "u2", name: "Sari", email: "sari@kantor.test", image: null, role: "admin", owner: false, joinedAt: new Date("2026-09-12T00:00:00Z") },
      ],
    })
    const row = screen.getByText("Budi").closest("li") as HTMLElement
    expect(row.textContent).toContain("Owner")
    expect(row.querySelector("button")).toBeNull()
  })
})

describe("MembersView join requests", () => {
  test("Members lists requests to join for admins", () => {
    const onApprove = mock()
    const onDecline = mock()
    const requests = [{ user: { id: "u9", name: "Budi", email: "budi@javan.co.id", image: null }, createdAt: new Date() }]
    const { unmount } = render(
      <MembersView
        meId="u1"
        isAdmin
        members={[]}
        invitations={[]}
        requests={requests}
        onApprove={onApprove}
        onDecline={onDecline}
        onInvite={mock(async () => [])}
        onSetRole={mock()}
        onRemove={mock()}
        onRevoke={mock()}
        onResend={mock()}
      />,
    )
    expect(screen.getByRole("heading", { name: /Requests to join/ })).toBeTruthy()
    expect(screen.getByText("budi@javan.co.id")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Approve Budi" }))
    fireEvent.click(screen.getByRole("button", { name: "Decline Budi" }))
    expect(onApprove).toHaveBeenCalledWith("u9")
    expect(onDecline).toHaveBeenCalledWith("u9")
    unmount()
    render(
      <MembersView
        meId="u1"
        isAdmin={false}
        members={[]}
        invitations={[]}
        requests={requests}
        onApprove={mock()}
        onDecline={mock()}
        onInvite={mock(async () => [])}
        onSetRole={mock()}
        onRemove={mock()}
        onRevoke={mock()}
        onResend={mock()}
      />,
    )
    expect(screen.queryByRole("heading", { name: /Requests to join/ })).toBeNull()
  })
})

describe("MembersView on a limited account", () => {
  test("no inviting or approving, but pending invitations and requests can still be cleared", () => {
    const props = view({
      membersAllowed: false,
      requests: [{ user: { id: "u9", name: "Rina", email: "rina@kantor.test", image: null }, createdAt: new Date("2026-10-20T00:00:00Z") }],
      onDecline: mock(),
    })
    expect(screen.getByText("Inviting teammates isn't available on this account.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Approve Rina" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Resend andi@gmail.com" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Revoke andi@gmail.com" }))
    expect(props.onRevoke).toHaveBeenCalledWith("i1")
    fireEvent.click(screen.getByRole("button", { name: "Decline Rina" }))
    expect(props.onDecline).toHaveBeenCalledWith("u9")
  })
})

describe("Members page details", () => {
  test("the header sums up people and pending invites", () => {
    expect(membersSummary(3, "Cuy Workspaces", 1)).toBe("3 people in Cuy Workspaces · 1 pending invite")
    expect(membersSummary(1, "Solo", 0)).toBe("1 person in Solo")
    expect(membersSummary(5, "Javan", 2)).toBe("5 people in Javan · 2 pending invites")
  })

  test("the send button counts the addresses", () => {
    expect(sendLabel(0)).toBe("Send invites")
    expect(sendLabel(1)).toBe("Send invite")
    expect(sendLabel(2)).toBe("Send 2 invites")
  })

  test("rows show who you are, each role, when people joined, and what each invite joins as", () => {
    view({
      members: [
        { id: "u0", name: "Ana", email: "ana@kantor.test", image: null, role: "admin", owner: true, joinedAt: new Date("2026-09-12T12:00:00Z") },
        ...members,
      ],
    })
    const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement
    expect(row("Ana").textContent).toContain("Owner")
    expect(row("Ana").textContent).toContain("Sep 12, 2026")
    expect(row("Budi").textContent).toContain("You")
    expect(row("Budi").textContent).toContain("Admin")
    const invite = screen.getByText("andi@gmail.com").closest("li") as HTMLElement
    expect(invite.textContent).toContain("Member")
    expect(invite.textContent).toContain("Sent ")
    expect(screen.getByRole("heading", { name: /^Members/ })).toBeTruthy()
  })
})

describe("MembersView search", () => {
  test("filters members and invites by name or email", () => {
    view()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search members" }), { target: { value: "sari" } })
    expect(screen.queryByText("budi@kantor.test")).toBeNull()
    expect(screen.getByText("sari@kantor.test")).toBeTruthy()
    expect(screen.queryByText("andi@gmail.com")).toBeNull()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search members" }), { target: { value: "zzz" } })
    expect(screen.getByText("Nobody matches “zzz”.")).toBeTruthy()
  })

  test("the side card explains each role", () => {
    view()
    expect(screen.getByRole("heading", { name: "Who can do what" })).toBeTruthy()
    expect(screen.getByText("Manage members, projects and integrations.")).toBeTruthy()
  })
})
