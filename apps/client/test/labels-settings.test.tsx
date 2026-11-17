import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { LabelsSettingsView } from "../src/features/labels/LabelsSettingsPage"

const bug = { id: "l1", name: "Bug", color: "red" as const, reportCount: 12 }
const checkout = { id: "l2", name: "Checkout", color: "blue" as const, reportCount: 1 }

function view(overrides: Partial<Parameters<typeof LabelsSettingsView>[0]> = {}) {
  const props = {
    labels: [bug, checkout],
    onCreate: mock(async () => {}),
    onRename: mock(async () => {}),
    onRecolor: mock(),
    onDelete: mock(),
    ...overrides,
  }
  render(<LabelsSettingsView {...props} />)
  return props
}

describe("the labels page", () => {
  test("lists labels with how many reports carry each", () => {
    view()
    expect(screen.getByText("Bug")).toBeTruthy()
    expect(screen.getByText("12 reports")).toBeTruthy()
    expect(screen.getByText("1 report")).toBeTruthy()
  })

  test("renaming saves on Enter and cancels on Escape", async () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: "Rename Bug" }))
    const field = screen.getByRole("textbox", { name: "Name of Bug" })
    fireEvent.change(field, { target: { value: "Defect" } })
    fireEvent.keyDown(field, { key: "Enter" })
    expect(props.onRename).toHaveBeenCalledWith("l1", "Defect")

    fireEvent.click(screen.getByRole("button", { name: "Rename Checkout" }))
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name of Checkout" }), { key: "Escape" })
    expect(screen.queryByRole("textbox", { name: "Name of Checkout" })).toBeNull()
  })

  test("renaming to a taken name shows the server's refusal next to the field", async () => {
    view({ onRename: mock(async () => Promise.reject(new Error("A label with this name already exists"))) })
    fireEvent.click(screen.getByRole("button", { name: "Rename Bug" }))
    const field = screen.getByRole("textbox", { name: "Name of Bug" })
    fireEvent.change(field, { target: { value: "Checkout" } })
    fireEvent.keyDown(field, { key: "Enter" })
    expect((await screen.findByRole("alert")).textContent).toBe("A label with this name already exists")
    expect(screen.getByRole("textbox", { name: "Name of Bug" })).toBeTruthy()
  })

  test("deleting asks first and says what it does", async () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: "Delete Bug" }))
    expect(await screen.findByText('Delete the label "Bug"?')).toBeTruthy()
    expect(screen.getByText("It comes off 12 reports.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Delete label" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(props.onDelete).toHaveBeenCalledWith("l1")
  })

  test("an empty workspace explains labels and offers to create the first", async () => {
    const props = view({ labels: [] })
    expect(screen.getByText("No labels yet")).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "New label" }), { target: { value: "Bug" } })
    fireEvent.click(screen.getByRole("button", { name: "Create label" }))
    expect(props.onCreate).toHaveBeenCalledWith("Bug")
    expect(props.onCreate).toHaveBeenCalledTimes(1)
  })
})
