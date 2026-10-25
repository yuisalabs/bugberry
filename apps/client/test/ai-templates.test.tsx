import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { TemplatesListView } from "../src/components/ai/TemplatesList"

const templates = [
  { id: "t1", name: "Steps to reproduce", skeleton: "## Steps to reproduce\n## Expected", instructions: "", updatedAt: new Date(0) },
  { id: "t2", name: "Short", skeleton: "", instructions: "One paragraph", updatedAt: new Date(0) },
]

function view(over: Partial<Parameters<typeof TemplatesListView>[0]> = {}) {
  const props = {
    templates,
    defaultTemplateId: "t1",
    usedByProjects: [] as string[],
    onCreate: mock(async () => {}),
    onUpdate: mock(async () => {}),
    onDelete: mock(async () => {}),
    ...over,
  }
  render(<TemplatesListView {...props} />)
  return props
}

const field = (name: string) => screen.getByRole("textbox", { name })
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })

describe("the templates list", () => {
  test("lists templates with the default marked", () => {
    view()
    const row = screen.getByText("Steps to reproduce").closest("li")!
    expect(within(row).getByText("Default")).toBeTruthy()
    expect(within(screen.getByText("Short").closest("li")!).queryByText("Default")).toBeNull()
  })

  test("New template opens a dialog with name, sections and extra instructions", async () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: "New template" }))
    type("Name", "QA Indonesia")
    type("Sections", "## Langkah\n## Hasil")
    type("Extra instructions", "Tulis dalam Bahasa Indonesia")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save template" })))
    expect(props.onCreate).toHaveBeenCalledWith({ name: "QA Indonesia", skeleton: "## Langkah\n## Hasil", instructions: "Tulis dalam Bahasa Indonesia" })
  })

  test("editing keeps the fields and calls onUpdate", async () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: "Edit Steps to reproduce" }))
    expect((field("Sections") as HTMLTextAreaElement).value).toBe("## Steps to reproduce\n## Expected")
    type("Name", "Repro steps")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save template" })))
    expect(props.onUpdate).toHaveBeenCalledWith("t1", { name: "Repro steps", skeleton: "## Steps to reproduce\n## Expected", instructions: "" })
  })

  test("deleting asks first and says when it is a default", async () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: "Delete Steps to reproduce" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("used as a default")
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })))
    expect(props.onDelete).toHaveBeenCalledWith("t1")
  })

  test("an empty name can't be saved", async () => {
    const props = view()
    fireEvent.click(screen.getByRole("button", { name: "New template" }))
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save template" })))
    expect(props.onCreate).not.toHaveBeenCalled()
    expect(screen.getByText("Give the template a name")).toBeTruthy()
  })

  test("a failed save shows why and keeps the dialog open", async () => {
    view({ onCreate: mock(async () => Promise.reject(new Error("Invalid request"))) })
    fireEvent.click(screen.getByRole("button", { name: "New template" }))
    type("Name", "X")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save template" })))
    expect(screen.getByRole("alert").textContent).toContain("Invalid request")
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
})
