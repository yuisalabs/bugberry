import { describe, expect, mock, test } from "bun:test"
import type { CaptureEvent } from "@bugberry/capture"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ReviewView, type ReviewViewProps } from "../../entrypoints/review/ReviewView"
import type { ReportDraft } from "../../lib/shared/types"

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

  test("the masked line", () => {
    view()
    expect(screen.getByText("Passwords and card numbers were masked in the logs")).toBeTruthy()
  })

  test("where it goes: Save to the workspace", () => {
    view()
    expect(screen.getByText("Save to")).toBeTruthy()
    expect(button(/Cuy Workspaces/)).toBeTruthy()
  })

  test("signed out: no workspace to pick, and Sign in to send in place of Create report", () => {
    const opened: string[] = []
    const realOpen = window.open
    window.open = ((url: string) => {
      opened.push(url)
      return null
    }) as typeof window.open
    try {
      view({ signInUrl: "https://bugberry.test/login" })
      expect(screen.queryByText("Save to")).toBeNull()
      expect(screen.queryByRole("button", { name: "Create report" })).toBeNull()
      const title = screen.getByLabelText("Title") as HTMLInputElement
      fireEvent.change(title, { target: { value: "Checkout hangs" } })
      expect(title.value).toBe("Checkout hangs")
      fireEvent.click(button("Sign in to send"))
      expect(opened).toEqual(["https://bugberry.test/login"])
    } finally {
      window.open = realOpen
    }
  })

  test("signed out, a draft that failed before offers no way to send but signing in", () => {
    view({ signInUrl: "https://bugberry.test/login", status: { failed: "Upload failed" }, trim: { startMs: 0, endMs: 1000 } })
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(button("Sign in to send")).toBeTruthy()
  })

  test("signed out, a trim that couldn't be made offers no full video to send", () => {
    view({ signInUrl: "https://bugberry.test/login", status: { trimFailed: "no encoder" } })
    expect(screen.queryByRole("button", { name: "Send full video" })).toBeNull()
  })

  test("a trim that couldn't be made offers no full video the workspace won't take", () => {
    view({ status: { trimFailed: "no encoder" }, fullVideoTooLong: true })
    expect(screen.getByText(/Couldn't trim the video/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Send full video" })).toBeNull()
  })

  test("a recording the time limit stopped says so", () => {
    view({ draft: { ...video, stoppedAtLimitMs: 120_000 } as ReportDraft })
    expect(screen.getByText("The recording stopped by itself at 2:00, the longest allowed.")).toBeTruthy()
  })

  test("a recording the reporter stopped says nothing about a limit", () => {
    view()
    expect(screen.queryByText(/stopped by itself/)).toBeNull()
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

describe("upload progress", () => {
  const MB = 1024 * 1024

  test("while sending, a bar above the footer shows how much has gone up", () => {
    view({ status: "sending", uploadProgress: { sent: 15 * MB, total: 35 * MB } })
    const bar = screen.getByRole("progressbar", { name: "Uploading video" })
    expect(bar.getAttribute("aria-valuenow")).toBe("42")
    expect(bar.getAttribute("aria-valuetext")).toBe("15 MB of 35 MB, 42%")
    expect(within(bar).getByText("15 MB of 35 MB · 42%")).toBeTruthy()
  })

  test("once everything is up, it says the report is being made", () => {
    view({ status: "sending", uploadProgress: { sent: 35 * MB, total: 35 * MB } })
    expect(screen.getByRole("progressbar", { name: "Creating report…" }).getAttribute("aria-valuenow")).toBe("100")
  })

  test("a screenshot says so", () => {
    view({ draft: screenshot, status: "sending", uploadProgress: { sent: 1, total: 4 } })
    expect(screen.getByRole("progressbar", { name: "Uploading screenshot" })).toBeTruthy()
  })

  test("no bar when not sending", () => {
    view({ status: "ready", uploadProgress: { sent: 1, total: 4 } })
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  test("no bar while sending until progress is known", () => {
    view({ status: "sending", uploadProgress: null })
    expect(screen.queryByRole("progressbar")).toBeNull()
  })
})

describe("trimming a recording", () => {
  test("the strip is there for videos from the start, with no button to open it", () => {
    view()
    expect(screen.getByRole("group", { name: "Trim" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Trim/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull()
    cleanup()
    view({ draft: screenshot })
    expect(screen.queryByRole("group", { name: "Trim" })).toBeNull()
  })

  test("moving a handle applies the range at once", () => {
    const changed = mock()
    view({ onTrimChange: changed })
    const start = screen.getByLabelText("Trim start")
    for (let i = 0; i < 10; i++) fireEvent.keyDown(start, { key: "ArrowRight" })
    expect(changed.mock.calls.at(-1)?.[0]).toEqual({ startMs: 1000, endMs: 42_000 })
  })

  test("Reset keeps the whole video", () => {
    const changed = mock()
    view({ trim: { startMs: 1000, endMs: 42_000 }, onTrimChange: changed })
    fireEvent.click(button("Reset"))
    expect(changed.mock.calls.at(-1)?.[0]).toBeNull()
  })

  test("moving the end back to the last step of a video that isn't a whole step long keeps the whole video", () => {
    const changed = mock()
    view({ draft: { ...video, durationMs: 42_350 } as ReportDraft, trim: { startMs: 0, endMs: 42_000 }, onTrimChange: changed })
    const end = screen.getByLabelText("Trim end")
    fireEvent.keyDown(end, { key: "ArrowRight" })
    fireEvent.keyDown(end, { key: "ArrowRight" })
    fireEvent.keyDown(end, { key: "ArrowRight" })
    fireEvent.keyDown(end, { key: "ArrowRight" })
    expect(changed.mock.calls.at(-1)?.[0]).toBeNull()
  })

  test("a saved trim shows in the strip and the tiles", () => {
    view({ trim: { startMs: 1000, endMs: 2000 } })
    expect(screen.getByText("0:01 – 0:02 · 1 s of 42 s")).toBeTruthy()
    expect(screen.getByText("0 errors")).toBeTruthy()
    expect(screen.getByText("0 failed")).toBeTruthy()
    expect(screen.getByText("13 steps")).toBeTruthy()
  })

  test("Create report sends with the strip as it stands", () => {
    const { props } = view({ trim: { startMs: 1000, endMs: 2000 } })
    fireEvent.click(button("Create report"))
    expect((props.onSend as ReturnType<typeof mock>).mock.calls).toHaveLength(1)
  })

  test("locked once a send has started", () => {
    view({ trimLocked: true })
    expect((screen.getByLabelText("Trim start") as HTMLInputElement).disabled).toBe(true)
    expect(button("Reset").hasAttribute("disabled") || button("Reset").getAttribute("aria-disabled") === "true").toBe(true)
    expect(screen.getByText("The video has already started sending.")).toBeTruthy()
  })

  test("preparing the video shows its percent", () => {
    view({ status: "sending", preparing: 0.45 })
    expect(screen.getByText("Preparing video… 45%")).toBeTruthy()
  })

  test("a failed trim offers the full video", () => {
    const { props } = view({ status: { trimFailed: "codec" } })
    expect(screen.getByText("Couldn't trim the video: codec")).toBeTruthy()
    fireEvent.click(button("Send full video"))
    expect((props.onSend as ReturnType<typeof mock>).mock.calls.at(-1)?.[2]).toEqual({ fullVideo: true })
  })
})

describe("closing while the video is prepared", () => {
  test("Close asks whether to leave the video being prepared", () => {
    view({ status: "sending", preparing: 0.3 })
    fireEvent.click(button("Close"))
    expect(screen.getByText("The video is still being prepared. Leave anyway?")).toBeTruthy()
  })
})

describe("the strip's preview", () => {
  test("its play button plays the selection, and reads Pause selection while it plays", () => {
    const play = mock()
    const { rerender, props } = view({ onTrimPlay: play })
    fireEvent.click(button("Play selection"))
    expect(play).toHaveBeenCalledTimes(1)
    rerender(<ReviewView {...props} trimPlaying />)
    expect(button("Pause selection")).toBeTruthy()
  })

  test("the playhead stands where the player is", () => {
    view({ trimPosition: 21_000 })
    expect((screen.getByLabelText("Playhead") as HTMLInputElement).value).toBe("21000")
  })

  test("the playhead moves anywhere in the video, past the trim's edges too", () => {
    const seek = mock()
    view({ trim: { startMs: 1000, endMs: 2000 }, trimPosition: 1500, onTrimSeek: seek })
    fireEvent.keyDown(screen.getByLabelText("Playhead"), { key: "End" })
    expect(seek.mock.calls.at(-1)?.[0]).toBe(42_000)
    fireEvent.keyDown(screen.getByLabelText("Playhead"), { key: "Home" })
    expect(seek.mock.calls.at(-1)?.[0]).toBe(0)
  })

  test("each edge is a handle with a grip", () => {
    const { container } = view()
    expect(container.querySelectorAll("[data-grip]")).toHaveLength(2)
  })
})
