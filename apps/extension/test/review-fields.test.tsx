import { afterEach, describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { ReviewView, type ReviewViewProps } from "../entrypoints/review/ReviewView"
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
  }
  render(<ReviewView {...props} />)
}

const title = () => screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement
const description = () => screen.getByRole("textbox", { name: "What went wrong?" }) as HTMLTextAreaElement

const original = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight")
afterEach(() => {
  if (original) Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", original)
})

describe("the title and description fields", () => {
  test("a long title wraps onto more lines instead of running off the edge, and stays one paragraph", () => {
    view()
    expect(title().tagName).toBe("TEXTAREA")
    fireEvent.change(title(), { target: { value: "AI settings page:\nclicks on page controls do nothing" } })
    expect(title().value).toBe("AI settings page: clicks on page controls do nothing")
    expect(fireEvent.keyDown(title(), { key: "Enter" })).toBe(false)
  })

  test("both fields grow with their text, so a written-up description shows in full", async () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: () => 240 })
    view()
    await act(async () => fireEvent.change(description(), { target: { value: "## Steps to reproduce\n1. a\n2. b\n3. c" } }))
    expect(description().style.height).toBe("240px")
    expect(title().style.height).toBe("240px")
  })
})
