import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { ReviewView, type ReviewViewProps } from "../entrypoints/review/ReviewView"
import type { ReportDraft } from "../lib/types"

const base = {
  id: "d1",
  createdAt: 0,
  page: { url: "https://shop.test/checkout", title: "Checkout" },
  device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
  debuggerGzip: null,
  status: "editing" as const,
  error: null,
  session: null,
  form: null,
}
const payload = { version: 1, capturedAt: 50_000, recordingStartedAt: 1000, incomplete: [], events: [] }
const video = { ...base, captureType: "video", video: new Blob(["v"]), durationMs: 42_000, recordingStartedAt: 1000, debuggerPayload: payload } as ReportDraft
const screenshot = { ...base, captureType: "screenshot", screenshot: new Blob(["png"]), annotations: [], debuggerPayload: payload } as ReportDraft

const templates = [
  { id: "t1", name: "Steps to reproduce", skeleton: "## Steps", instructions: "" },
  { id: "t2", name: "Short", skeleton: "", instructions: "One paragraph" },
]

type Ai = NonNullable<ReviewViewProps["ai"]>
const ai = (over: Partial<Ai> = {}): Ai => ({
  path: "team",
  templates,
  templateFor: (projectId) => (projectId === "p2" ? "t2" : "t1"),
  isAdmin: false,
  settingsUrl: "https://bugberry.test/app/settings/ai",
  ...over,
})

function view(overrides: Partial<ReviewViewProps> = {}) {
  const props: ReviewViewProps = {
    embedded: false,
    draft: video,
    media: <div>media</div>,
    workspaces: [{ id: "w1", name: "Cuy" } as ReviewViewProps["workspaces"][number]],
    workspaceId: "w1",
    projects: [
      { id: "p1", name: "Web", slug: "web", workspaceId: "w1", urlPatterns: [], logoUrl: null, createdAt: new Date(0) },
      { id: "p2", name: "Admin", slug: "admin", workspaceId: "w1", urlPatterns: [], logoUrl: null, createdAt: new Date(0) },
    ],
    email: "dana@acme.io",
    name: "Dana",
    status: "ready",
    includeCity: false,
    cityNote: null,
    onSend: mock(),
    onDiscard: mock(),
    onAgain: mock(),
    onClose: mock(),
    onWorkspaceChange: mock(),
    onIncludeCityChange: mock(),
    onChange: mock(),
    ai: ai(),
    onAiWrite: mock(async () => ({ title: "Checkout: Pay spins", description: "## Steps\n1. Click Pay" })),
    ...overrides,
  }
  render(<ReviewView {...props} />)
  return props
}

const titleInput = () => screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement
const descriptionInput = () => screen.getByRole("textbox", { name: "What went wrong?" }) as HTMLTextAreaElement
const write = () => screen.getByRole("button", { name: "Write with AI" })
/** The template picker, showing `template`: its name holds both the label and the chosen value. */
const templatePicker = (template: string) =>
  screen.getByRole("button", { name: (name) => name.includes("Template") && name.includes(template) })

describe("Write with AI in the review", () => {
  test("a video review shows the template picker on the project's default and Write with AI", () => {
    view()
    expect(write()).toBeTruthy()
    expect(templatePicker("Steps to reproduce")).toBeTruthy()
  })

  test("a screenshot review has no AI row", () => {
    view({ draft: screenshot })
    expect(screen.queryByRole("button", { name: "Write with AI" })).toBeNull()
  })

  test("what was typed goes as the hint; the draft replaces both fields; Undo restores them", async () => {
    const props = view()
    fireEvent.change(titleInput(), { target: { value: "pay fails" } })
    fireEvent.change(descriptionInput(), { target: { value: "debit card" } })
    await act(async () => fireEvent.click(write()))
    expect(props.onAiWrite).toHaveBeenCalledWith({ templateId: "t1", hint: { title: "pay fails", description: "debit card" } })
    expect(titleInput().value).toBe("Checkout: Pay spins")
    expect(descriptionInput().value).toBe("## Steps\n1. Click Pay")
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    expect(titleInput().value).toBe("pay fails")
    expect(descriptionInput().value).toBe("debit card")
  })

  test("Undo disappears once a field is edited again", async () => {
    view()
    await act(async () => fireEvent.click(write()))
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy()
    fireEvent.change(titleInput(), { target: { value: "My own title" } })
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  })

  test("an error shows under the button and leaves the form unchanged", async () => {
    view({ onAiWrite: mock(async () => Promise.reject(new Error("Your AI provider says the quota is used up."))) })
    fireEvent.change(titleInput(), { target: { value: "pay fails" } })
    await act(async () => fireEvent.click(write()))
    expect(screen.getByRole("alert").textContent).toBe("Your AI provider says the quota is used up.")
    expect(titleInput().value).toBe("pay fails")
  })

  test("while writing, a second press does nothing", async () => {
    let finish: (value: { title: string; description: string }) => void = () => {}
    const onAiWrite = mock(() => new Promise<{ title: string; description: string }>((resolve) => (finish = resolve)))
    view({ onAiWrite })
    await act(async () => fireEvent.click(write()))
    await act(async () => fireEvent.click(write()))
    expect(onAiWrite).toHaveBeenCalledTimes(1)
    await act(async () => finish({ title: "T", description: "D" }))
    expect(titleInput().value).toBe("T")
  })

  test("changing the project moves the picker to that project's default", async () => {
    view()
    fireEvent.click(screen.getByLabelText("Project"))
    fireEvent.click(screen.getByRole("option", { name: "Admin" }))
    await act(async () => {})
    expect(templatePicker("Short")).toBeTruthy()
  })

  test("without any key, members see the ask-your-admin line and admins a link to Settings → AI", () => {
    view({ ai: ai({ path: null }) })
    expect(screen.queryByRole("button", { name: "Write with AI" })).toBeNull()
    expect(screen.getByText("Ask your admin to set up AI in Settings → AI")).toBeTruthy()
  })

  test("an admin without a key gets a link to set it up", () => {
    view({ ai: ai({ path: null, isAdmin: true }) })
    expect(screen.getByRole("link", { name: "Set up AI" }).getAttribute("href")).toBe("https://bugberry.test/app/settings/ai")
  })
})
