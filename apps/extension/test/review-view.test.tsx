import { describe, expect, mock, test } from "bun:test"
import type { CaptureEvent } from "@bugberry/capture"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { ReviewView, type ReviewViewProps } from "../entrypoints/review/ReviewView"
import type { ReportDraft } from "../lib/types"

const events: CaptureEvent[] = [
  { kind: "network", t: 1200, method: "POST", url: "https://shop.test/api/pay?id=1", status: 500 },
  { kind: "console", t: 1300, level: "error", args: ["a"] },
  { kind: "console", t: 1400, level: "error", args: ["b"] },
  { kind: "error", t: 1500, message: "boom" },
  { kind: "network", t: 1600, method: "GET", url: "https://shop.test/api/x", failed: "TypeError" },
  ...Array.from({ length: 13 }, (_, index): CaptureEvent => ({ kind: "action", t: 2000 + index, type: "click", target: "b" })),
]

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

const video = {
  ...base,
  captureType: "video",
  video: new Blob(["v"]),
  durationMs: 42_000,
  recordingStartedAt: 1000,
  debuggerPayload: {
    version: 1,
    capturedAt: 50_000,
    recordingStartedAt: 1000,
    incomplete: [],
    events,
    notes: [{ n: 1, atMs: 31_000, text: "Spins forever", author: "Dana" }],
  },
} as ReportDraft

const screenshot = {
  ...base,
  captureType: "screenshot",
  screenshot: new Blob(["png"]),
  annotations: [],
  debuggerPayload: { version: 1, capturedAt: 50_000, recordingStartedAt: null, incomplete: [], events: [] },
} as ReportDraft

function view(overrides: Partial<ReviewViewProps> = {}) {
  const props: ReviewViewProps = {
    embedded: false,
    draft: video,
    media: <div>media</div>,
    workspaces: [{ id: "w1", name: "Cuy Workspaces" } as ReviewViewProps["workspaces"][number]],
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
    ...overrides,
  }
  const rendered = render(<ReviewView {...props} />)
  return { props, ...rendered }
}

const button = (name: string | RegExp) => screen.getByRole("button", { name })

describe("what the review shows", () => {
  test("a title suggested from the failed request, until the reporter edits it", () => {
    view()
    const title = screen.getByLabelText("Title") as HTMLInputElement
    expect(title.value).toBe("POST /api/pay failed (500)")
    expect(screen.getByText("Suggested from the failed request")).toBeTruthy()
    fireEvent.change(title, { target: { value: "Checkout hangs after clicking Pay" } })
    expect(screen.queryByText("Suggested from the failed request")).toBeNull()
  })

  test("the title is optional: left empty, the report is a Bugcord or a Bugshoot by me", () => {
    const { props } = view()
    const title = screen.getByLabelText("Title") as HTMLInputElement
    expect(title.placeholder).toBe("Bugcord by Dana")
    fireEvent.change(title, { target: { value: "" } })
    fireEvent.click(button("Create report"))
    expect(screen.queryByRole("alert")).toBeNull()
    expect((props.onSend as ReturnType<typeof mock>).mock.calls.at(-1)?.[0]).toMatchObject({ title: "" })
  })

  test("an untitled screenshot is a Bugshoot", () => {
    view({ draft: screenshot })
    expect((screen.getByLabelText("Title") as HTMLInputElement).placeholder).toBe("Bugshoot by Dana")
  })

  test("the four tiles", () => {
    view()
    expect(screen.getByText("3 errors")).toBeTruthy()
    expect(screen.getByText("2 failed")).toBeTruthy()
    expect(screen.getByText("13 steps")).toBeTruthy()
    expect(screen.getByText("Chrome 141 · Windows")).toBeTruthy()
  })

  test("the masked line, and no Trim", () => {
    view()
    expect(screen.getByText("Passwords and card numbers were masked in the logs")).toBeTruthy()
    expect(screen.queryByText(/Trim/)).toBeNull()
  })

  test("where it goes: Save to the workspace", () => {
    view()
    expect(screen.getByText("Save to")).toBeTruthy()
    expect(button(/Cuy Workspaces/)).toBeTruthy()
  })

  test("a screenshot shows its kind and size", () => {
    view({ draft: screenshot, mediaSize: { width: 1920, height: 945 } })
    expect(screen.getByText("Screenshot")).toBeTruthy()
    expect(screen.getByText("· 1920 × 945")).toBeTruthy()
  })

  test("nobody is assigned until someone is picked", () => {
    const { props } = view({ members: [{ id: "u2", name: "Ansar R.", email: "ansar@acme.io" }] })
    expect(button(/Unassigned/)).toBeTruthy()
    fireEvent.click(button("Create report"))
    expect((props.onSend as ReturnType<typeof mock>).mock.calls[0]?.[0]).not.toMatchObject({ assigneeId: "u2" })
  })
})

describe("buttons", () => {
  test("Record again asks first, saying the recording won't be kept", () => {
    const { props } = view()
    fireEvent.click(button("Record again"))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Record again?")).toBeTruthy()
    expect(within(dialog).getByText("This recording won't be saved. A new one starts on the same page.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Record again" }))
    expect(props.onAgain).toHaveBeenCalledTimes(1)
  })

  test("a screenshot has Retake, which asks first too", () => {
    const { props } = view({ draft: screenshot })
    expect(screen.queryByRole("button", { name: "Record again" })).toBeNull()
    fireEvent.click(button("Retake"))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Retake the screenshot?")).toBeTruthy()
    expect(within(dialog).getByText("This screenshot won't be saved. A new one is taken of the same page.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Retake" }))
    expect(props.onAgain).toHaveBeenCalledTimes(1)
  })

  test("Discard asks first", () => {
    const { props } = view()
    fireEvent.click(button("Discard"))
    fireEvent.click(button("Delete"))
    expect(props.onDiscard).toHaveBeenCalledTimes(1)
  })

  test("edited notes go with the report", () => {
    const { props } = view()
    const note = screen.getByDisplayValue("Spins forever")
    fireEvent.change(note, { target: { value: "Spins after Pay" } })
    fireEvent.click(button("Create report"))
    expect(props.onSend).toHaveBeenCalledTimes(1)
    const [form, notes] = (props.onSend as ReturnType<typeof mock>).mock.calls[0] as [{ title: string }, Array<{ text: string }>]
    expect(form.title).toBe("POST /api/pay failed (500)")
    expect(notes.map((entry) => entry.text)).toEqual(["Spins after Pay"])
  })

  test("a note can be removed", () => {
    const { props } = view()
    fireEvent.click(button("Remove note 1"))
    fireEvent.click(button("Create report"))
    const [, notes] = (props.onSend as ReturnType<typeof mock>).mock.calls[0] as [unknown, unknown[]]
    expect(notes).toEqual([])
  })
})

describe("closing", () => {
  test("× asks to keep a draft; Esc does nothing", () => {
    const { props } = view()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.click(button("Close"))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Keep this as a draft?")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep" }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    const [kept] = (props.onClose as ReturnType<typeof mock>).mock.calls[0] as [{ form: { title: string }; notes: unknown[] } | null]
    expect(kept?.form.title).toBe("POST /api/pay failed (500)")
    expect(kept?.notes).toHaveLength(1)
  })
})

describe("after sending", () => {
  const sent = { sent: { id: "r1", reportUrl: "https://b.test/app/r/1", shareUrl: "https://b.test/s/x" } }

  test("Report created stays over the page with the capture, and closes without asking", () => {
    const { props } = view({ status: sent })
    expect(screen.getByText("Report created")).toBeTruthy()
    expect((screen.getByLabelText("Share link") as HTMLInputElement).value).toBe("https://b.test/s/x")
    expect(screen.getByRole("link", { name: "Open report" }).getAttribute("href")).toBe("https://b.test/app/r/1")
    expect(screen.getByText("media")).toBeTruthy()
    fireEvent.click(button("Close"))
    expect(props.onClose).toHaveBeenCalledWith(null)
    fireEvent.click(button("Done"))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  test("the created report, as the server has it", () => {
    view({
      status: sent,
      sentDetails: {
        number: 149,
        title: "Checkout hangs on Pay",
        status: "open",
        priority: "high",
        visibility: "public",
        projectName: "Quinella AI",
        assigneeName: "Ansar R.",
      },
    })
    expect(screen.getByText("BB-149")).toBeTruthy()
    expect(screen.getByText("Checkout hangs on Pay")).toBeTruthy()
    expect(screen.getByText("Quinella AI")).toBeTruthy()
    expect(screen.getByText("Ansar R.")).toBeTruthy()
    expect(screen.getAllByText("Anyone with the link").length).toBeGreaterThan(0)
  })

  test("trackers send without leaving the page; Record another starts a new capture", () => {
    const onSendToTracker = mock()
    const onAnother = mock()
    view({ status: sent, trackers: [{ id: "i1", provider: "github", label: "GitHub", state: "idle" }], onSendToTracker, onAnother })
    fireEvent.click(button("GitHub"))
    expect(onSendToTracker).toHaveBeenCalledWith("i1")
    fireEvent.click(button("Record another"))
    expect(onAnother).toHaveBeenCalledTimes(1)
  })

  test("a failure says why and can be tried again with the same form", () => {
    const { props } = view({ status: { failed: "Network error" } })
    expect(screen.getByText("Network error")).toBeTruthy()
    fireEvent.click(button("Try again"))
    expect(props.onSend).toHaveBeenCalledTimes(1)
  })
})

test("over a page, the city can't be asked for, so it isn't offered", () => {
  const { unmount } = view({ embedded: true })
  expect(screen.queryByRole("checkbox", { name: "Include my city" })).toBeNull()
  unmount()
  view({ embedded: false })
  expect(screen.getByRole("checkbox", { name: "Include my city" })).toBeTruthy()
})

test("every edit is handed up, so closing the tab keeps it", () => {
  const { props } = view()
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Checkout hangs" } })
  fireEvent.change(screen.getByDisplayValue("Spins forever"), { target: { value: "Spins after Pay" } })
  const calls = (props.onChange as ReturnType<typeof mock>).mock.calls as Array<[{ title: string }, Array<{ text: string }>]>
  const [form, notes] = calls.at(-1) ?? []
  expect(form?.title).toBe("Checkout hangs")
  expect(notes?.map((note) => note.text)).toEqual(["Spins after Pay"])
})

describe("Copy link", () => {
  const sent = { sent: { id: "r1", reportUrl: "https://b.test/app/r/1", shareUrl: "https://b.test/s/x" } }

  test("the link is copied as soon as the report exists", async () => {
    const writeText = mock(async (_text: string) => {})
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    view({ status: sent })
    expect(await screen.findByText("Copied")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("https://b.test/s/x")
  })

  test("when the clipboard refuses, Copy stays, then says to copy it by hand", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new DOMException("blocked", "NotAllowedError")) },
      configurable: true,
    })
    view({ status: sent })
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }))
    expect(await screen.findByText(/didn't allow copying/)).toBeTruthy()
    expect((screen.getByLabelText("Share link") as HTMLInputElement).value).toBe("https://b.test/s/x")
  })
})

describe("a workspace under account limits", () => {
  const warning = "This workspace already has 5 recordings. Delete one in the dashboard."

  test("a full workspace: usage, warning, Open dashboard, and Create report disabled", () => {
    const onOpenDashboard = mock()
    const { props } = view({ usage: "Recordings 5/5", limitWarning: warning, sendBlocked: true, onOpenDashboard })
    expect(screen.getByText("Recordings 5/5")).toBeTruthy()
    expect(screen.getByText(warning)).toBeTruthy()
    fireEvent.click(button("Open dashboard"))
    expect(onOpenDashboard).toHaveBeenCalledTimes(1)
    const create = button("Create report")
    expect(create.hasAttribute("disabled") || create.getAttribute("data-disabled") !== null).toBe(true)
    fireEvent.click(create)
    expect(props.onSend).not.toHaveBeenCalled()
  })

  test("someone who can't delete gets no Open dashboard link", () => {
    view({ limitWarning: "This workspace already has 5 recordings. Ask a workspace admin to delete one.", sendBlocked: true })
    expect(screen.queryByRole("button", { name: "Open dashboard" })).toBeNull()
  })

  test("a failed send into a full workspace offers no Try again", () => {
    view({ status: { failed: "x" }, sendBlocked: true })
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  test("with room, Create report works and no warning shows", () => {
    const { props } = view({ usage: "Recordings 3/5" })
    expect(screen.getByText("Recordings 3/5")).toBeTruthy()
    expect(screen.queryByText(/already has/)).toBeNull()
    fireEvent.click(button("Create report"))
    expect(props.onSend).toHaveBeenCalledTimes(1)
  })
})
