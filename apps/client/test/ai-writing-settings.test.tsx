import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { AiWritingSettingsView } from "../src/features/ai/AiWritingSettings"
import { choose } from "./fields"
import type { AiSetup } from "../src/features/ai/queries"

const templates = [
  { id: "t1", name: "Steps to reproduce", skeleton: "## Steps to reproduce", instructions: "", updatedAt: new Date(0) },
  { id: "t2", name: "Short", skeleton: "", instructions: "One paragraph", updatedAt: new Date(0) },
]

const setup = (over: Partial<AiSetup> = {}): AiSetup => ({
  team: { configured: false },
  sendResponseBodies: false,
  defaultTemplateId: "t1",
  projectDefaults: [],
  templates,
  role: "admin",
  ...over,
})

function view(over: Partial<Parameters<typeof AiWritingSettingsView>[0]> = {}) {
  const props = {
    setup: setup(),
    projects: [{ id: "p1", name: "Checkout Web" }],
    onSaveProvider: mock(async () => {}),
    onRemoveProvider: mock(async () => {}),
    onChangeSettings: mock(async () => {}),
    ...over,
  }
  render(<AiWritingSettingsView {...props} />)
  return props
}

const type = (label: string, value: string) => fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } })

describe("the team key", () => {
  test("an admin without a key sees the provider form with the OpenAI preset and a model field", () => {
    view()
    expect((screen.getByRole("radio", { name: "OpenAI" }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole("radio", { name: "OpenAI-compatible" })).toBeTruthy()
    expect(screen.getByLabelText("API key")).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Model" })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Base URL" })).toBeNull()
  })

  test("OpenAI-compatible asks for a base URL; saving sends preset, address, model and key", async () => {
    const props = view()
    fireEvent.click(screen.getByRole("radio", { name: "OpenAI-compatible" }))
    type("Base URL", "https://quinella.test/v1")
    type("Model", "quinella-7b")
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "k-123" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test and save" })))
    expect(props.onSaveProvider).toHaveBeenCalledWith({ preset: "custom", baseUrl: "https://quinella.test/v1", model: "quinella-7b", apiKey: "k-123" })
  })

  test("a saved key shows only its hint; saving without a new key leaves it out", async () => {
    const props = view({ setup: setup({ team: { configured: true, preset: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", keyHint: "sk-…a1b2" } }) })
    expect(screen.getByText("sk-…a1b2")).toBeTruthy()
    expect(screen.getByLabelText("API key").getAttribute("placeholder")).toBe("Leave empty to keep the saved key")
    type("Model", "gpt-4.1")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test and save" })))
    expect(props.onSaveProvider).toHaveBeenCalledWith({ preset: "openai", model: "gpt-4.1" })
  })

  test("a first save needs a key and a model", async () => {
    const props = view()
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test and save" })))
    expect(props.onSaveProvider).not.toHaveBeenCalled()
    expect(screen.getByText("Enter the model, for example gpt-4.1-mini")).toBeTruthy()
  })

  test("a failed test shows the server's message under the form", async () => {
    view({ onSaveProvider: mock(async () => Promise.reject(new Error("The AI key was rejected. Update it in Settings → AI (ask your admin)."))) })
    type("Model", "gpt-4.1-mini")
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-bad" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test and save" })))
    expect(screen.getByRole("alert").textContent).toContain("The AI key was rejected")
  })

  test("members see whether a team key is set, not its details, and no switch", () => {
    view({ setup: setup({ role: "member", team: { configured: true } }) })
    expect(screen.getByText("Your admin has set up a team AI key.")).toBeTruthy()
    expect(screen.queryByLabelText("API key")).toBeNull()
    expect(screen.queryByRole("switch", { name: "Send response bodies to AI" })).toBeNull()
  })

  test("members without a team key are told who sets it and where their own goes", () => {
    view({ setup: setup({ role: "member" }) })
    expect(screen.getByText(/No team AI key yet/)).toBeTruthy()
    expect(screen.getByText(/extension's settings/)).toBeTruthy()
  })
})

describe("settings", () => {
  test("the response-bodies switch is off by default and warns about personal data", async () => {
    const props = view()
    const toggle = screen.getByRole("switch", { name: "Send response bodies to AI" }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(screen.getByText(/names or emails/)).toBeTruthy()
    await act(async () => fireEvent.click(toggle))
    expect(props.onChangeSettings).toHaveBeenCalledWith({ sendResponseBodies: true })
  })

  test("admins choose the workspace default and a default per project", async () => {
    const props = view()
    choose("Workspace default", "Short")
    await act(async () => {})
    expect(props.onChangeSettings).toHaveBeenCalledWith({ defaultTemplateId: "t2" })
    choose("Checkout Web", "Short")
    await act(async () => {})
    expect(props.onChangeSettings).toHaveBeenCalledWith({ projectDefaults: [{ projectId: "p1", templateId: "t2" }] })
  })

  test("project defaults sit under a Per project heading that says what they do", () => {
    view()
    expect(screen.getByRole("heading", { name: "Per project" })).toBeTruthy()
    expect(screen.getByText("Reports from a project's pages start with its template.")).toBeTruthy()
  })

  test("a project with its own template can go back to the workspace default", async () => {
    const props = view({ setup: setup({ projectDefaults: [{ projectId: "p1", templateId: "t2" }] }) })
    choose("Checkout Web", "Use the workspace default")
    await act(async () => {})
    expect(props.onChangeSettings).toHaveBeenCalledWith({ projectDefaults: [{ projectId: "p1", templateId: null }] })
  })
})
