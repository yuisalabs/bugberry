import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { RiSettings3Line, RiUserAddLine } from "@remixicon/react"
import { SettingsTabs } from "../src/components/layout/SettingsTabs"
import { WorkspaceSettingsView } from "../src/features/workspaces/WorkspaceSettingsView"
import type { SlugAnswer } from "../src/features/workspaces/workspace-slug"
import { fileInput } from "./fields"

const workspace = { id: "w1", name: "Javan QA", slug: "javan-qa", logoUrl: null as string | null }
const answer = (available: boolean) =>
  mock(async (query: { slug?: string }): Promise<SlugAnswer> => ({
    slug: query.slug ?? "",
    available,
    reason: available ? null : "taken",
  }))

function view(overrides: Partial<Parameters<typeof WorkspaceSettingsView>[0]> = {}) {
  const props = {
    workspace,
    origin: "https://bugberry.kantor.com",
    busy: false,
    onSave: mock(),
    onLogo: mock(),
    onRemoveLogo: mock(),
    check: answer(true),
    measure: async () => ({ width: 256, height: 256 }),
    ...overrides,
  }
  render(<WorkspaceSettingsView {...props} />)
  return props
}

const save = () => screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement

describe("WorkspaceSettingsView", () => {
  test("shows and saves name and URL", async () => {
    const props = view()
    expect((screen.getByRole("textbox", { name: "Workspace URL" }) as HTMLInputElement).value).toBe("javan-qa")
    // Inside the box from tablet width up, above the field on phones: CSS shows one of the two.
    const hosts = screen.getAllByText("bugberry.kantor.com/")
    expect(hosts.map((host) => host.classList.contains("sm:hidden") || (host.classList.contains("hidden") && host.classList.contains("sm:flex")))).toEqual([
      true,
      true,
    ])
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace URL" }), { target: { value: "javan-team" } })
    await waitFor(() => expect(screen.getByText("Available")).toBeTruthy(), { timeout: 2000 })
    fireEvent.click(save())
    expect(props.onSave).toHaveBeenCalledWith({ slug: "javan-team" })
  })

  test("a taken URL disables Save; a name change alone sends only the name", async () => {
    const props = view({ check: answer(false) })
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace URL" }), { target: { value: "someone-else" } })
    await waitFor(() => expect(screen.getByText("Taken")).toBeTruthy(), { timeout: 2000 })
    expect(save().disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace URL" }), { target: { value: "javan-qa" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Javan QA Team" } })
    fireEvent.click(save())
    expect(props.onSave).toHaveBeenCalledWith({ name: "Javan QA Team" })
  })

  test("changes and removes the logo", async () => {
    const props = view({ workspace: { ...workspace, logoUrl: "http://localhost:3000/api/workspace-logos/w1/a.png" } })
    const file = new File([new Uint8Array(10)], "logo.png", { type: "image/png" })
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await waitFor(() => expect(props.onLogo).toHaveBeenCalledWith(file))
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }))
    expect(props.onRemoveLogo).toHaveBeenCalled()
  })

  test("Remove shows only with a logo", () => {
    view()
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull()
  })

  test("the footer says whether there is something to save", () => {
    view({ saved: true })
    expect(screen.getByRole("status").textContent).toBe("Saved")
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Javan QA Team" } })
    expect(screen.getByRole("status").textContent).toBe("Unsaved changes")
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Javan QA" } })
    expect(screen.getByRole("status").textContent).toBe("Saved")
  })

  test("each setting is labelled by its row", () => {
    view()
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Logo" })).toBeTruthy()
    expect(screen.getByText("Using the first letter for now")).toBeTruthy()
    expect(screen.getByText("Upload a logo to replace it everywhere.")).toBeTruthy()
  })
})

describe("SettingsTabs", () => {
  test("shows one part at a time, picked from the list beside it", () => {
    window.history.replaceState(null, "", window.location.pathname)
    render(
      <SettingsTabs
        label="Workspace settings"
        sections={[
          { id: "general", label: "General", icon: RiSettings3Line, panel: <p>General form</p> },
          { id: "joining", label: "Joining", icon: RiUserAddLine, panel: <p>Joining form</p> },
        ]}
      />,
    )
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("General form")).toBeTruthy()
    expect(screen.queryByText("Joining form")).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "Joining" }))
    expect(screen.getByText("Joining form")).toBeTruthy()
    expect(screen.queryByText("General form")).toBeNull()
    expect(window.location.hash).toBe("#joining")
  })
})
