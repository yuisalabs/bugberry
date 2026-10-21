import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { InviteDialogView } from "../src/components/InviteDialog"

function view(overrides: Partial<ComponentProps<typeof InviteDialogView>> = {}) {
  const props = {
    workspaceName: "Cuy Workspaces",
    inviteLink: null,
    onTurnOnLink: mock(),
    onInvite: mock(async (emails: string[]) => emails.map((email) => ({ email, status: "sent" as const }))),
    onCancel: mock(),
    manageMembers: <a href="/app/settings/members">Manage members</a>,
    ...overrides,
  }
  render(<InviteDialogView {...props} />)
  return props
}

describe("InviteDialogView", () => {
  test("names the workspace and sends every address typed as a chip", async () => {
    const props = view()
    expect(screen.getByRole("heading", { name: "Invite people to Cuy Workspaces" })).toBeTruthy()
    expect(screen.getByText("They'll get an email with a link to join.")).toBeTruthy()
    expect(screen.getByText("Separate with commas or press Enter.")).toBeTruthy()
    fireEvent.paste(screen.getByRole("textbox", { name: "Email addresses" }), {
      clipboardData: { getData: () => "sari@company.com, andi@gmail.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send 2 invites" }))
    expect(props.onInvite).toHaveBeenCalledWith(["sari@company.com", "andi@gmail.com"])
    await waitFor(() => expect(screen.getByText("sari@company.com: Invited")).toBeTruthy())
  })

  test("an invite link that is off can be turned on from here", () => {
    const props = view()
    expect(screen.getByText("Invite link is off")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }))
    expect(props.onTurnOnLink).toHaveBeenCalled()
  })

  test("an invite link that is on shows itself and can be copied", () => {
    view({ inviteLink: "https://bugberry.kantor.test/join/7KX-29QF" })
    expect(screen.getByText("Invite link is on")).toBeTruthy()
    expect(screen.getByText("bugberry.kantor.test/join/7KX-29QF")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull()
  })

  test("Cancel closes, and Members is one click away", () => {
    const props = view()
    expect((screen.getByRole("button", { name: "Send invites" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(props.onCancel).toHaveBeenCalled()
    expect(screen.getByRole("link", { name: "Manage members" }).getAttribute("href")).toBe("/app/settings/members")
  })
})
