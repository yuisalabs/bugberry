import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { ReviewView, type ReviewViewProps, type TrackerChoice } from "../../entrypoints/review/ReviewView"
import type { ReportDraft } from "../../lib/types"

const draft = {
  id: "d1",
  createdAt: 0,
  page: { url: "https://shop.test/checkout", title: "Checkout" },
  device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
  debuggerGzip: null,
  status: "editing" as const,
  error: null,
  session: null,
  form: null,
  captureType: "video",
  video: new Blob(["v"]),
  durationMs: 42_000,
  recordingStartedAt: 1000,
  debuggerPayload: { version: 1, capturedAt: 50_000, recordingStartedAt: 1000, incomplete: [], events: [] },
} as ReportDraft

const trackers: TrackerChoice[] = [
  { id: "i1", provider: "github", label: "yuisa-scarlet/praktikum_papb", state: "idle" },
  { id: "i2", provider: "activecollab", label: "Project #261", state: "idle" },
  { id: "i3", provider: "jira", label: "WEB", state: "idle" },
  { id: "i4", provider: "gitlab", label: "kantor/web", state: { url: "https://gitlab.test/kantor/web/-/issues/1" } },
]

function view(overrides: Partial<ReviewViewProps> = {}) {
  const props: ReviewViewProps = {
    embedded: false,
    draft,
    media: <div>media</div>,
    workspaces: [{ id: "w1", name: "Cuy" } as ReviewViewProps["workspaces"][number]],
    workspaceId: "w1",
    projects: [],
    email: "dana@acme.io",
    name: "Dana",
    status: { sent: { id: "r1", reportUrl: "https://bugberry.test/app/r/r1", shareUrl: "https://bugberry.test/s/abc" } },
    includeCity: false,
    cityNote: null,
    trackers,
    onSend: mock(),
    onDiscard: mock(),
    onAgain: mock(),
    onClose: mock(),
    onWorkspaceChange: mock(),
    onIncludeCityChange: mock(),
    onChange: mock(),
    onSendToTracker: mock(),
    ...overrides,
  }
  render(<ReviewView {...props} />)
  return props
}

const project = (id: string, name: string) => ({ id, name, slug: id, workspaceId: "w1", urlPatterns: [], logoUrl: null, createdAt: new Date(0) })

describe("the trackers after sending", () => {
  test("each tracker shows its integration's mark and lines up on the left", () => {
    view()
    for (const [name, mark] of [
      ["yuisa-scarlet/praktikum_papb", "github"],
      ["Project #261", "activecollab"],
      ["WEB", "jira"],
      [/kantor\/web/, "gitlab"],
    ] as const) {
      const choice = screen.getByRole(mark === "gitlab" ? "link" : "button", { name })
      expect(choice.querySelector("[data-tracker-mark]")?.getAttribute("data-tracker-mark")).toBe(mark)
      expect(choice.className).toContain("justify-start")
      expect(choice.className).not.toContain("justify-center")
    }
    expect(document.querySelector('[data-tracker-mark="jira"]')?.getAttribute("src")).toBe("/assets/integrations/jira.svg")
  })
})

describe("a report sent without a project", () => {
  test("picking a project here moves the report, so its trackers can show up", async () => {
    const onPickProject = mock(async () => {})
    view({ trackers: [], needsProject: true, projects: [project("p1", "Web"), project("p2", "Quinella AI")], onPickProject })
    expect(screen.getByText("Pick a project to send it to that project's trackers.")).toBeTruthy()
    expect(screen.queryByText("Pick a project next time to send reports to its trackers.")).toBeNull()
    // By keyboard: a mouse press can be swallowed by pointer events another test file left unfinished on window.
    const trigger = screen.getByLabelText("Project")
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const option = await screen.findByRole("option", { name: "Quinella AI" })
    act(() => option.focus())
    fireEvent.keyDown(option, { key: "Enter" })
    fireEvent.keyUp(option, { key: "Enter" })
    await act(async () => {})
    expect(onPickProject).toHaveBeenCalledWith("p2")
  })

  test("a report already in a project has no picker", () => {
    view({ needsProject: false, projects: [project("p1", "Web")], onPickProject: mock() })
    expect(screen.queryByLabelText("Project")).toBeNull()
  })

  test("a workspace without projects says how to get there", () => {
    view({ trackers: [], needsProject: true, projects: [], onPickProject: mock() })
    expect(screen.queryByLabelText("Project")).toBeNull()
    expect(screen.getByText("Create a project with a tracker to send reports there.")).toBeTruthy()
  })
})
