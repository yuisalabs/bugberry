import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CreateWorkspaceForm, inviteProblem } from "../src/features/workspaces/CreateWorkspaceDialog"
import type { SlugAnswer } from "../src/features/workspaces/workspace-slug"
import { fileInput } from "./fields"

const sized = async () => ({ width: 256, height: 256 })
const suggest = (slug: string, available = true): ((query: { name?: string; slug?: string }) => Promise<SlugAnswer>) =>
  mock(async (query: { name?: string; slug?: string }) =>
    query.slug !== undefined
      ? { slug: query.slug, available, reason: available ? null : ("taken" as const) }
      : { slug, available: true, reason: null },
  )

function form(overrides: Partial<Parameters<typeof CreateWorkspaceForm>[0]> = {}) {
  const props = {
    origin: "https://bugberry.kantor.com",
    done: false,
    message: null,
    onSubmit: mock(async () => {}),
    onClose: mock(),
    check: suggest("javan-qa"),
    measure: sized,
    ...overrides,
  }
  render(<CreateWorkspaceForm {...props} />)
  return props
}

const create = () => screen.getByRole("button", { name: "Create workspace" }) as HTMLButtonElement

describe("CreateWorkspaceForm", () => {
  test("an account that can't add members isn't offered invites", () => {
    form({ canInvite: false })
    expect(screen.queryByRole("textbox", { name: "Invite teammates" })).toBeNull()
  })

  test("creates with name, suggested slug, logo and invites", async () => {
    const props = form()
    expect(screen.getByRole("heading", { name: "Create a workspace" })).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), { target: { value: "Javan QA" } })
    await waitFor(() => expect(screen.getByText("Available")).toBeTruthy(), { timeout: 2000 })
    expect((screen.getByRole("textbox", { name: "Workspace URL" }) as HTMLInputElement).value).toBe("javan-qa")
    const logo = new File([new Uint8Array(10)], "logo.png", { type: "image/png" })
    fireEvent.change(fileInput(), { target: { files: [logo] } })
    await waitFor(() => expect(document.querySelector("img")).toBeTruthy())
    const invite = screen.getByRole("textbox", { name: "Invite teammates" })
    fireEvent.change(invite, { target: { value: "priya@javan.co.id" } })
    fireEvent.keyDown(invite, { key: "Enter" })
    fireEvent.click(create())
    await waitFor(() =>
      expect(props.onSubmit).toHaveBeenCalledWith({
        name: "Javan QA",
        slug: "javan-qa",
        slugEdited: false,
        logo,
        emails: ["priya@javan.co.id"],
      }),
    )
  })

  test("the prefix is this server", () => {
    form()
    expect(screen.getByText("bugberry.kantor.com/")).toBeTruthy()
  })

  test("Create is disabled while the slug is taken, invalid or checking, and without a name", async () => {
    form({ check: suggest("javan-qa", false) })
    expect(create().disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), { target: { value: "Javan QA" } })
    expect(create().disabled).toBe(true)
    await waitFor(() => expect(create().disabled).toBe(false), { timeout: 2000 })
    const url = screen.getByRole("textbox", { name: "Workspace URL" })
    fireEvent.change(url, { target: { value: "a" } })
    expect(create().disabled).toBe(true)
    fireEvent.change(url, { target: { value: "taken-one" } })
    await waitFor(() => expect(screen.getByText("Taken")).toBeTruthy(), { timeout: 2000 })
    expect(create().disabled).toBe(true)
  })

  test("a failed logo or invite keeps the workspace and turns the button into Done", () => {
    const props = form({ done: true, message: "Workspace created, but the logo didn't upload" })
    expect(screen.getByText("Workspace created, but the logo didn't upload")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Create workspace" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(props.onClose).toHaveBeenCalled()
  })

  test("once created, the URL no longer says Taken (it is this workspace's own)", async () => {
    form({ done: true, message: "Workspace created, but the logo didn't upload", check: suggest("javan-qa", false) })
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace URL" }), { target: { value: "javan-qa" } })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.queryByText("Taken")).toBeNull()
  })
})

describe("inviteProblem", () => {
  test("names each address that was not sent and why", () => {
    expect(inviteProblem([{ email: "a@kantor.test", status: "sent" }])).toBeNull()
    expect(
      inviteProblem([
        { email: "a@kantor.test", status: "sent" },
        { email: "eve@x.test", status: "not_allowed" },
        { email: "budi@kantor.test", status: "member" },
      ]),
    ).toBe("Workspace created, but some invites weren't sent: eve@x.test: Not allowed on this server; budi@kantor.test: Already a member")
  })

  test("a refused request says the server's reason", () => {
    expect(inviteProblem(new Error("Set up email (EMAIL_DRIVER) to send invitations"))).toBe(
      "Workspace created, but the invites weren't sent: Set up email (EMAIL_DRIVER) to send invitations",
    )
  })
})
