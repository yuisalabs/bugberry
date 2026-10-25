import { describe, expect, mock, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { ReviewView, type ReviewViewProps, type TrackerChoice } from "../entrypoints/review/ReviewView"
import type { ReportDraft } from "../lib/types"

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

function view() {
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
  }
  render(<ReviewView {...props} />)
}

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
