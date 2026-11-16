import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { LabelPickerView } from "../src/features/labels/LabelPicker"

const bug = { id: "bug-id", name: "Bug", color: "red" as const }
const checkout = { id: "checkout-id", name: "Checkout", color: "blue" as const }

function open(props: Partial<Parameters<typeof LabelPickerView>[0]> = {}) {
  const onSet = mock()
  const onCreate = mock(async () => {})
  render(<LabelPickerView labels={[bug]} options={[bug, checkout]} onSet={onSet} onCreate={onCreate} {...props} />)
  fireEvent.click(screen.getByRole("button", { name: "Add label" }))
  return { onSet, onCreate }
}

describe("the label picker", () => {
  test("shows the report's labels as chips", () => {
    render(<LabelPickerView labels={[bug, checkout]} options={[bug, checkout]} onSet={mock()} onCreate={mock()} />)
    expect(screen.getByText("Bug")).toBeTruthy()
    expect(screen.getByText("Checkout")).toBeTruthy()
  })

  test("checking a label sets the report's labels to the old ones plus it", async () => {
    const { onSet } = open()
    fireEvent.click(await screen.findByRole("checkbox", { name: "Checkout" }))
    expect(onSet).toHaveBeenCalledWith(["bug-id", "checkout-id"])
  })

  test("unchecking a label takes it off", async () => {
    const { onSet } = open()
    fireEvent.click(await screen.findByRole("checkbox", { name: "Bug" }))
    expect(onSet).toHaveBeenCalledWith([])
  })

  test("typing a name nobody has offers to create it", async () => {
    const { onCreate } = open()
    fireEvent.change(await screen.findByRole("searchbox", { name: "Find or create a label" }), { target: { value: "Payments" } })
    expect(screen.queryByRole("checkbox", { name: "Bug" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: 'Create "Payments"' }))
    expect(onCreate).toHaveBeenCalledWith("Payments")
  })

  test("a name that exists in another case offers that label, not Create", async () => {
    open()
    fireEvent.change(await screen.findByRole("searchbox", { name: "Find or create a label" }), { target: { value: "checkout" } })
    expect(screen.getByRole("checkbox", { name: "Checkout" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Create/ })).toBeNull()
  })

  test("at 10 labels, unchecked items are disabled and say why", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, color: "gray" as const }))
    open({ labels: ten, options: [...ten, checkout] })
    expect(await screen.findByText("A report takes at most 10 labels.")).toBeTruthy()
    expect((screen.getByRole("checkbox", { name: "Checkout" }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole("button", { name: /^Create/ })).toBeNull()
  })

  test("a refused save shows the server's message", () => {
    render(<LabelPickerView labels={[]} options={[]} onSet={mock()} onCreate={mock()} error="Label not found in this workspace" />)
    expect(screen.getByRole("alert").textContent).toBe("Label not found in this workspace")
  })
})
