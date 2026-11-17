import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { inviteOutcomeText, ProjectGuestsView } from "../src/features/projects/ProjectGuests"
import { CommentsSection } from "../src/features/reports/comments/CommentsSection"

const guest = { id: "g1", name: "Client Name", email: "client@acme.test", image: null, since: new Date("2026-11-01T00:00:00Z") }
const pending = { invitationId: "i1", email: "later@acme.test", expiresAt: new Date("2026-11-20T00:00:00Z") }

function view(overrides: Partial<Parameters<typeof ProjectGuestsView>[0]> = {}) {
  const props = {
    projectName: "Storefront",
    guests: [guest],
    pending: [pending],
    results: null,
    inviting: false,
    error: null,
    onInvite: mock(),
    onRemove: mock(),
    ...overrides,
  }
  render(<ProjectGuestsView {...props} />)
  return props
}

describe("the project's guests", () => {
  test("the card lists guests and pending invitations", () => {
    view()
    expect(screen.getByText("Client Name")).toBeTruthy()
    expect(screen.getByText("client@acme.test")).toBeTruthy()
    expect(screen.getByText("later@acme.test")).toBeTruthy()
    expect(screen.getByText("Invited")).toBeTruthy()
  })

  test("inviting shows each address's outcome in words", () => {
    view({
      results: [
        { email: "client@acme.test", status: "sent" },
        { email: "ana@team.test", status: "member" },
        { email: "bob@other.test", status: "not_allowed" },
      ],
    })
    expect(screen.getByText("Invitation sent to client@acme.test.")).toBeTruthy()
    expect(screen.getByText("ana@team.test is already a member of this workspace.")).toBeTruthy()
    expect(screen.getByText("This server doesn't let bob@other.test sign in. Add their domain to ALLOWED_EMAIL_DOMAINS first.")).toBeTruthy()
    expect(inviteOutcomeText({ email: "x@y.test", status: "guest" })).toBe("x@y.test is already a guest of this project.")
  })

  test("removing a guest asks first", async () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: "Remove Client Name" }))
    expect(await screen.findByText("Remove Client Name from Storefront?")).toBeTruthy()
    expect(screen.getByText("They lose access to its reports at once.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Remove guest" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(props.onRemove).toHaveBeenCalledWith("g1")
  })

  test("an empty project says what guests are", () => {
    view({ guests: [], pending: [] })
    expect(screen.getByText(/A guest reads this project's reports and comments/)).toBeTruthy()
  })
})

describe("the notice where members write", () => {
  const props = {
    threads: [],
    activity: null,
    people: [],
    me: { id: "u1", role: "member" as const, name: "Ana" },
    busy: false,
    showActivity: false,
    onShowActivity: mock(),
    onAdd: mock(async () => {}),
    onEdit: mock(async () => {}),
    onDelete: mock(),
    onReact: mock(),
  }

  test("the composer warns a member when the project has guests", () => {
    render(<CommentsSection {...props} guestNotice="Storefront" />)
    expect(screen.getByText("Guests of Storefront can read comments here.")).toBeTruthy()
  })

  test("no notice without guests, and none for a guest", () => {
    const { unmount } = render(<CommentsSection {...props} />)
    expect(screen.queryByText(/can read comments here/)).toBeNull()
    unmount()
    render(<CommentsSection {...props} me={{ ...props.me, role: "guest" }} guestNotice="Storefront" />)
    expect(screen.queryByText(/can read comments here/)).toBeNull()
  })
})
