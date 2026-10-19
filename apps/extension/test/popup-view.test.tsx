import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { PopupView, type PopupViewProps } from "../entrypoints/popup/PopupView"
import { DEFAULT_CAPTURE_PREFS } from "../lib/capture-prefs"
import type { ReportDraft } from "../lib/types"

const draft = (id: string, title: string) =>
  ({ id, status: "editing", captureType: "screenshot", page: { url: `https://app.test/${id}`, title } }) as ReportDraft

function view(overrides: Partial<PopupViewProps> = {}) {
  const props: PopupViewProps = {
    session: { kind: "signed-in", name: "Ana", email: "ana@kantor.test" },
    serverHost: "bugberry.kantor.com",
    prefs: DEFAULT_CAPTURE_PREFS,
    micLabel: "MacBook Pro Microphone",
    screenshotShortcut: "Alt+Shift+C",
    recording: { recording: false },
    drafts: [],
    logsAvailable: true,
    error: null,
    busy: false,
    onPrefs: mock(),
    onMicToggle: mock(),
    onScreenshot: mock(),
    onRecord: mock(),
    onSignIn: mock(),
    onRetry: mock(),
    onOpenSettings: mock(),
    onOpenDashboard: mock(),
    onOpenDraft: mock(),
    onDeleteDraft: mock(),
    ...overrides,
  }
  render(<PopupView {...props} />)
  return props
}

const button = (name: string | RegExp) => screen.getByRole("button", { name })

describe("signed in", () => {
  test("both rows, the shortcut, and the menu with the sign-in line and drafts", () => {
    view({ drafts: [draft("d1", "Checkout"), draft("d2", "Login")] })
    expect(button(/Capture screenshot/)).toBeTruthy()
    expect(button(/Record tab/)).toBeTruthy()
    expect(screen.getByText("Alt+Shift+C")).toBeTruthy()
    fireEvent.click(button("More"))
    expect(screen.getByText("Signed in as Ana · bugberry.kantor.com")).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Unsent drafts (2)" })).toBeTruthy()
  })

  test("no drafts, no drafts item", () => {
    view()
    fireEvent.click(button("More"))
    expect(screen.queryByRole("menuitem", { name: /Unsent drafts/ })).toBeNull()
  })

  test("the drafts view opens, deletes, and goes back", () => {
    const props = view({ drafts: [draft("d1", "Checkout"), draft("d2", "Login")] })
    fireEvent.click(button("More"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Unsent drafts (2)" }))
    expect(screen.getByText("Checkout")).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0] as HTMLElement)
    expect(props.onOpenDraft).toHaveBeenCalledWith("d1")
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1] as HTMLElement)
    expect(props.onDeleteDraft).toHaveBeenCalledWith("d2")
    fireEvent.click(button("Back"))
    expect(button(/Capture screenshot/)).toBeTruthy()
  })

  test("the grid icon opens the dashboard", () => {
    const props = view()
    fireEvent.click(button("Open dashboard"))
    expect(props.onOpenDashboard).toHaveBeenCalledTimes(1)
  })
})

describe("not ready to send", () => {
  test("signed out: only the sign-in card", () => {
    const props = view({ session: { kind: "signed-out" } })
    expect(screen.getByText("Sign in to BugBerry")).toBeTruthy()
    fireEvent.click(button("Sign in"))
    expect(props.onSignIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: /Capture screenshot/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull()
  })

  test("no server: the settings card", () => {
    const props = view({ session: { kind: "no-server" } })
    expect(screen.getByText("Choose your BugBerry server")).toBeTruthy()
    fireEvent.click(button("Open settings"))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  test("unreachable: a warning with Try again, and the rows stay", () => {
    const props = view({ session: { kind: "unreachable", host: "bugberry.kantor.com" } })
    expect(screen.getByText("Can't reach bugberry.kantor.com")).toBeTruthy()
    fireEvent.click(button("Try again"))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
    expect(button(/Capture screenshot/)).toBeTruthy()
  })
})

describe("screenshot row", () => {
  test("the row captures, the chevron opens the modes, and there is no Full page", () => {
    const props = view()
    fireEvent.click(button(/Capture screenshot/))
    expect(props.onScreenshot).toHaveBeenCalledTimes(1)
    fireEvent.click(button("Screenshot options"))
    expect(screen.getByText("What to capture")).toBeTruthy()
    expect(screen.getByText("What you see on screen right now")).toBeTruthy()
    expect(screen.getByText("Console and network logs from this tab are attached automatically.")).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: /Select area/ }))
    expect(props.onPrefs).toHaveBeenCalledWith({ screenshotMode: "area" })
    expect(screen.queryByText(/Full page/)).toBeNull()
  })
})

describe("record row", () => {
  test("a screen: its label, system audio and both notes", () => {
    view({ prefs: { ...DEFAULT_CAPTURE_PREFS, recordSource: "screen" } })
    expect(button(/Record screen/)).toBeTruthy()
    fireEvent.click(button("Record options"))
    expect(screen.getByRole("switch", { name: /System audio/ })).toBeTruthy()
    expect(screen.getByText("Sound from apps and videos")).toBeTruthy()
    expect(screen.getByText("Click “Record screen” and Chrome will ask which screen to share.")).toBeTruthy()
    expect(screen.getByText("Console and network logs come from this tab only.")).toBeTruthy()
  })

  test("a window has no system audio", () => {
    view({ prefs: { ...DEFAULT_CAPTURE_PREFS, recordSource: "window" } })
    fireEvent.click(button("Record options"))
    expect(screen.queryByRole("switch", { name: /System audio/ })).toBeNull()
    expect(screen.getByText("Click “Record window” and Chrome will ask which window to share.")).toBeTruthy()
  })

  test("a screen from a page that isn't a web page says there are no logs", () => {
    view({ prefs: { ...DEFAULT_CAPTURE_PREFS, recordSource: "screen" }, logsAvailable: false })
    fireEvent.click(button("Record options"))
    expect(screen.getByText("Console and network logs aren't available on this page.")).toBeTruthy()
  })

  test("choosing a source, the microphone and its badge", () => {
    const props = view()
    expect(screen.getByText("Mic off")).toBeTruthy()
    fireEvent.click(button("Record options"))
    fireEvent.click(screen.getByRole("radio", { name: "Window" }))
    expect(props.onPrefs).toHaveBeenCalledWith({ recordSource: "window" })
    expect(screen.getByText("MacBook Pro Microphone")).toBeTruthy()
    fireEvent.click(screen.getByRole("switch", { name: /Microphone/ }))
    expect(props.onMicToggle).toHaveBeenCalledWith(true)
  })

  test("the countdown can be turned off", () => {
    const props = view()
    fireEvent.click(button("Record options"))
    const countdown = screen.getByRole("switch", { name: /3-second countdown/ })
    expect((countdown as HTMLInputElement).checked).toBe(true)
    fireEvent.click(countdown)
    expect(props.onPrefs).toHaveBeenCalledWith({ countdown: false })
  })

  test("Mic on when the microphone is chosen; the row starts the recording", () => {
    const props = view({ prefs: { ...DEFAULT_CAPTURE_PREFS, mic: true } })
    expect(screen.getByText("Mic on")).toBeTruthy()
    fireEvent.click(button(/Record tab/))
    expect(props.onRecord).toHaveBeenCalledTimes(1)
  })
})

test("an error shows as an alert", () => {
  view({ error: "Microphone is blocked. Allow it for BugBerry in Chrome's site settings." })
  expect(screen.getByRole("alert").textContent).toBe("Microphone is blocked. Allow it for BugBerry in Chrome's site settings.")
})

describe("the More menu", () => {
  // Intent's Menu also closes on a click outside it; React Aria owns that, and happy-dom can't replay it.
  test("closes on Esc, and once something is chosen", () => {
    const props = view()
    fireEvent.click(button("More"))
    expect(screen.getByRole("menu")).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.click(button("More"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }))
    expect(props.onOpenSettings).toHaveBeenCalled()
    expect(screen.queryByRole("menu")).toBeNull()
  })
})
