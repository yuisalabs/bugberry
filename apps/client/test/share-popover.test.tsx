import { describe, expect, mock, test } from "bun:test"
import type { Visibility } from "@bugberry/shared"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { SharePopoverView } from "../src/components/report/SharePopover"

function view(overrides: Partial<Parameters<typeof SharePopoverView>[0]> = {}) {
  const props = {
    number: 12,
    visibility: "workspace" as Visibility,
    internalDomain: "ptmaju.com",
    editable: true,
    busy: false,
    onChange: mock(),
    onCopy: mock(async () => {}),
    onReset: mock(async () => {}),
    ...overrides,
  }
  render(<SharePopoverView {...props} />)
  return props
}

describe("SharePopoverView", () => {
  test("fits a phone screen", () => {
    view()
    // Testing Library renders into a container div; its first child is the popover content.
    expect(document.body.firstElementChild?.firstElementChild?.className).toContain("calc(100vw-24px)")
  })

  test("names the report and who can open the link", () => {
    view()
    expect(screen.getByText("Share report")).toBeTruthy()
    expect(screen.getByText("BB-12")).toBeTruthy()
    expect(screen.getByText("Who can open this link")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Workspace members only/ })).toBeTruthy()
  })

  test("changing access picks another level", () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: /Workspace members only/ }))
    expect(screen.getByRole("option", { name: /Workspace members only/ }).getAttribute("aria-selected")).toBe("true")
    fireEvent.click(screen.getByRole("option", { name: /Anyone with the link/ }))
    expect(props.onChange).toHaveBeenCalledWith("public")
  })

  test("Reset link is only offered for public links", () => {
    view()
    expect(screen.queryByRole("button", { name: "Reset link" })).toBeNull()
  })

  test("Reset link asks first, and Cancel goes back", async () => {
    const props = view({ visibility: "public" })
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }))
    expect(screen.getByText("Reset this link?")).toBeTruthy()
    expect(screen.getByText("The old link stops working right away. Anyone you sent it to will need the new one.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByText("Reset this link?")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Reset link" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset link" }))
    })
    expect(props.onReset).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Reset this link?")).toBeNull()
  })

  test("other members see the levels disabled, with the reason", () => {
    view({ editable: false, visibility: "public" })
    expect((screen.getByRole("button", { name: /Anyone with the link/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Only the reporter or an admin can change this")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Reset link" })).toBeNull()
  })

  test("Copy link copies and reads Copied", async () => {
    const props = view()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    })
    expect(props.onCopy).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy()
  })
})
