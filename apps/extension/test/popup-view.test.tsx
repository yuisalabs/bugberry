import { describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { micMeterOn, PopupView, type PopupViewProps } from "../entrypoints/popup/PopupView"
import { DEFAULT_CAPTURE_PREFS } from "../lib/capture-prefs"
import type { ReportDraft } from "../lib/types"

const draft = (id: string, title: string) =>
  ({ id, status: "editing", captureType: "screenshot", page: { url: `https://app.test/${id}`, title } }) as ReportDraft

function view(overrides: Partial<PopupViewProps> = {}) {
  const props: PopupViewProps = {
    session: { kind: "signed-in", name: "Ana", email: "ana@kantor.test" },
    serverHost: "bugberry.kantor.com",
    prefs: DEFAULT_CAPTURE_PREFS,
    mic: { access: "granted", devices: [], defaultId: null, level: still(0) },
    recording: { recording: false },
    live: { recording: false },
    activeTabId: 1,
    drafts: [],
    logsAvailable: true,
    tabRecorder: true,
    hostAccess: true,
    error: null,
    busy: false,
    onPrefs: mock(),
    onMicChoose: mock(),
    onMicAllow: mock(),
    onMicPicker: mock(),
    camera: { access: "granted", devices: [{ id: "cam1", name: "FaceTime HD" }] },
    onCameraChoose: mock(),
    onCameraAllow: mock(),
    onScreenshot: mock(),
    onRecord: mock(),
    onPause: mock(),
    onResume: mock(),
    onRestart: mock(),
    onDiscard: mock(),
    onStop: mock(),
    onSignIn: mock(),
    onRetry: mock(),
    onOpenSettings: mock(),
    onOpenDashboard: mock(),
    onOpenDraft: mock(),
    onDeleteDraft: mock(),
    onAllowHosts: mock(),
    ...overrides,
  }
  render(<PopupView {...props} />)
  return props
}

/** A level that never changes. */
const still = (value: number) => ({ get: () => value, subscribe: () => () => {} })

const button = (name: string | RegExp) => screen.getByRole("button", { name })
const radio = (name: string | RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement
const record = (source: "tab" | "screen" | "window") => ({ ...DEFAULT_CAPTURE_PREFS, captureKind: "record" as const, recordSource: source })

describe("tiles and dial", () => {
  test("Visible area is chosen by default and the dial captures", () => {
    const props = view()
    expect(radio("Visible area").checked).toBe(true)
    expect(radio("Tab").checked).toBe(false)
    fireEvent.click(button("Capture visible area"))
    expect(props.onScreenshot).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Alt\+Shift/)).toBeNull()
  })

  test("Select area: its caption", () => {
    view({ prefs: { ...DEFAULT_CAPTURE_PREFS, screenshotMode: "area" } })
    expect(button("Select an area")).toBeTruthy()
  })

  test("choosing a tile saves the row and the choice", () => {
    const props = view()
    fireEvent.click(radio("Screen"))
    expect(props.onPrefs).toHaveBeenCalledWith({ captureKind: "record", recordSource: "screen" })
    fireEvent.click(radio("Select area"))
    expect(props.onPrefs).toHaveBeenCalledWith({ captureKind: "screenshot", screenshotMode: "area" })
  })

  test("Tab: mic and countdown chips, the tab info, the dial records", () => {
    const props = view({ prefs: record("tab") })
    expect(radio("Tab").checked).toBe(true)
    expect(button(/Mic off/)).toBeTruthy()
    expect(button("3s countdown").getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("Only this tab is recorded. Other tabs and apps stay private.")).toBeTruthy()
    fireEvent.click(button("Record this tab"))
    expect(props.onRecord).toHaveBeenCalledTimes(1)
  })

  test("Screen: 3s and System audio chips", () => {
    const props = view({ prefs: record("screen") })
    expect(button("3s")).toBeTruthy()
    expect(button("System audio").getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(button("System audio"))
    expect(props.onPrefs).toHaveBeenCalledWith({ systemAudio: false })
    expect(screen.getByText("Your browser asks which screen to share. Logs come from this tab only.")).toBeTruthy()
    expect(screen.getByText("Logs from this tab only")).toBeTruthy()
  })

  test("Window: no System audio", () => {
    view({ prefs: record("window") })
    expect(button("Record a window")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "System audio" })).toBeNull()
  })

  test("the countdown chip turns the countdown off", () => {
    const props = view({ prefs: record("tab") })
    fireEvent.click(button("3s countdown"))
    expect(props.onPrefs).toHaveBeenCalledWith({ countdown: false })
  })

  test("without a tab recorder: no Tab tile, no System audio, a stored tab shows as window", () => {
    view({ tabRecorder: false, prefs: record("tab") })
    expect(screen.queryByRole("radio", { name: "Tab" })).toBeNull()
    expect(radio("Window").checked).toBe(true)
    expect(screen.queryByRole("button", { name: "System audio" })).toBeNull()
  })

  test("busy: the dial waits", () => {
    view({ busy: true })
    expect(button("Capture visible area").hasAttribute("disabled")).toBe(true)
  })
})

describe("footer", () => {
  test("Logs on, with console and network attached", () => {
    view()
    expect(screen.getByText("Console and network attached")).toBeTruthy()
    expect(screen.getByText("Logs on")).toBeTruthy()
  })

  test("a page without logs: Logs off", () => {
    view({ logsAvailable: false })
    expect(screen.getByText("Logs aren't available on this page")).toBeTruthy()
    expect(screen.getByText("Logs off")).toBeTruthy()
  })
})

describe("the More menu", () => {
  test("the account, the drafts and Settings", () => {
    view({ drafts: [draft("d1", "Checkout"), draft("d2", "Login")], usage: "Screenshots 3/5 · Recordings 5/5" })
    fireEvent.click(button("More"))
    expect(screen.getByText("Signed in as")).toBeTruthy()
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText("bugberry.kantor.com")).toBeTruthy()
    expect(screen.getByText("Screenshots 3/5 · Recordings 5/5")).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Unsent drafts (2)" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /Settings/ })).toBeTruthy()
  })

  test("no drafts, no drafts item", () => {
    view()
    fireEvent.click(button("More"))
    expect(screen.queryByRole("menuitem", { name: /Unsent drafts/ })).toBeNull()
  })

  // Intent's Menu also closes on a click outside it; React Aria owns that, and happy-dom can't replay it.
  test("closes on Esc, and once something is chosen", () => {
    const props = view()
    fireEvent.click(button("More"))
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.click(button("More"))
    fireEvent.click(screen.getByRole("menuitem", { name: /Settings/ }))
    expect(props.onOpenSettings).toHaveBeenCalled()
    expect(screen.queryByRole("menu")).toBeNull()
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
    expect(button("Capture visible area")).toBeTruthy()
  })

  test("the grid icon opens the dashboard", () => {
    const props = view()
    fireEvent.click(button("Open dashboard"))
    expect(props.onOpenDashboard).toHaveBeenCalledTimes(1)
  })
})

describe("limits", () => {
  test("a warning for the chosen kind when it is full, and the dial still works", () => {
    const props = view({
      prefs: record("tab"),
      recordWarning: "This workspace is full for recordings. Delete one in the dashboard.",
      screenshotWarning: "This workspace is full for screenshots.",
    })
    expect(screen.getByText("This workspace is full for recordings. Delete one in the dashboard.")).toBeTruthy()
    expect(screen.queryByText("This workspace is full for screenshots.")).toBeNull()
    fireEvent.click(button("Record this tab"))
    expect(props.onRecord).toHaveBeenCalledTimes(1)
  })

  test("nothing about limits when there are none", () => {
    view()
    expect(screen.queryByText(/is full for/)).toBeNull()
  })
})

describe("not ready to send", () => {
  test("signed out: only the sign-in card", () => {
    const props = view({ session: { kind: "signed-out" } })
    expect(screen.getByText("Sign in to BugBerry")).toBeTruthy()
    fireEvent.click(button("Sign in"))
    expect(props.onSignIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("radio")).toBeNull()
    expect(screen.queryByRole("button", { name: "Capture visible area" })).toBeNull()
  })

  test("no server: the settings card", () => {
    const props = view({ session: { kind: "no-server" } })
    expect(screen.getByText("Choose your BugBerry server")).toBeTruthy()
    fireEvent.click(button("Open settings"))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  test("unreachable: a warning with Try again, and the tiles stay", () => {
    const props = view({ session: { kind: "unreachable", host: "bugberry.kantor.com" } })
    expect(screen.getByText("Can't reach bugberry.kantor.com")).toBeTruthy()
    fireEvent.click(button("Try again"))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
    expect(button("Capture visible area")).toBeTruthy()
  })

  test("an error shows as an alert", () => {
    view({ error: "Microphone is blocked. Allow it for BugBerry in Chrome's site settings." })
    expect(screen.getByRole("alert").textContent).toBe("Microphone is blocked. Allow it for BugBerry in Chrome's site settings.")
  })
})

describe("website access", () => {
  test("asks for website access when it was revoked", () => {
    const props = view({ hostAccess: false })
    fireEvent.click(button("Allow access to websites"))
    expect(props.onAllowHosts).toHaveBeenCalledTimes(1)
    expect(screen.getByText("BugBerry can't read this page. Allow access to websites to capture logs.")).toBeTruthy()
    expect(screen.getByText("Logs off")).toBeTruthy()
  })

  test("no button while access is granted", () => {
    view()
    expect(screen.queryByRole("button", { name: "Allow access to websites" })).toBeNull()
  })
})

const devices = [
  { id: "a", name: "Microphone Array", detail: "Realtek(R) Audio · built-in", short: "Realtek Audio", kind: "built-in" as const },
  { id: "h", name: "AirPods Pro", detail: "Bluetooth headset", short: "AirPods Pro", kind: "headset" as const },
  { id: "u", name: "Blue Yeti", detail: "USB microphone", short: "Blue Yeti", kind: "usb" as const },
]

describe("microphone picker", () => {
  test("before access: No microphone and Allow microphone access", () => {
    const props = view({ prefs: record("tab"), mic: { access: "prompt", devices: [], defaultId: null, level: still(0) } })
    fireEvent.click(button(/Mic off/))
    expect(props.onMicPicker).toHaveBeenCalledWith(true)
    expect(radio(/No microphone/).checked).toBe(true)
    expect(screen.queryByText(/found/)).toBeNull()
    fireEvent.click(button(/Allow microphone access/))
    expect(props.onMicAllow).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Chrome asks for mic access the first time. Your choice is remembered.")).toBeTruthy()
  })

  test("access blocked: an instruction instead of Allow", () => {
    view({ prefs: record("tab"), mic: { access: "denied", devices: [], defaultId: null, level: still(0) } })
    fireEvent.click(button(/Mic off/))
    expect(screen.getByText("Microphone is blocked. Allow it for BugBerry in Chrome's site settings.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Allow microphone access/ })).toBeNull()
  })

  test("devices: the count, choosing one, the picker closes", () => {
    const props = view({ prefs: record("tab"), mic: { access: "granted", devices, defaultId: "a", level: still(0.5) } })
    fireEvent.click(button(/Mic off/))
    expect(screen.getByText("3 found")).toBeTruthy()
    expect(screen.getByText("Realtek(R) Audio · built-in")).toBeTruthy()
    fireEvent.click(radio(/Microphone Array/))
    expect(props.onMicChoose).toHaveBeenCalledWith("a")
    expect(screen.queryByText("3 found")).toBeNull()
  })

  test("No microphone turns it off", () => {
    const props = view({ prefs: { ...record("tab"), mic: true, micDeviceId: "a" }, mic: { access: "granted", devices, defaultId: "a", level: still(0) } })
    fireEvent.click(button(/Realtek Audio/))
    fireEvent.click(radio(/No microphone/))
    expect(props.onMicChoose).toHaveBeenCalledWith(null)
  })

  test("Esc closes without a choice", () => {
    const props = view({ prefs: record("tab"), mic: { access: "granted", devices, defaultId: "a", level: still(0) } })
    fireEvent.click(button(/Mic off/))
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(props.onMicChoose).not.toHaveBeenCalled()
    expect(props.onMicPicker).toHaveBeenLastCalledWith(false)
  })

  test("Esc closes it while the chip still has focus", () => {
    view({ prefs: record("tab"), mic: { access: "granted", devices, defaultId: "a", level: still(0) } })
    fireEvent.click(button(/Mic off/))
    fireEvent.keyDown(button(/Mic off/), { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("a press on another button closes it", () => {
    view({ prefs: record("tab"), mic: { access: "granted", devices, defaultId: "a", level: still(0) } })
    fireEvent.click(button(/Mic off/))
    fireEvent.pointerDown(button("Open dashboard"))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("a chosen microphone shows on the chip and in the info", () => {
    view({ prefs: { ...record("tab"), mic: true, micDeviceId: "a" }, mic: { access: "granted", devices, defaultId: "h", level: still(0) } })
    expect(button(/Realtek Audio/)).toBeTruthy()
    expect(
      screen.getByText("Only this tab is recorded, with your voice from Realtek Audio. Other tabs and apps stay private."),
    ).toBeTruthy()
  })

  test("Mic on with no microphone found: the chip and the picker both say none", () => {
    view({ prefs: { ...record("tab"), mic: true }, mic: { access: "granted", devices: [], defaultId: null, level: still(0) } })
    fireEvent.click(button(/Mic off/))
    expect(radio(/No microphone/).checked).toBe(true)
  })

  test("a chosen microphone that is gone falls back to the default one's name", () => {
    view({ prefs: { ...record("tab"), mic: true, micDeviceId: "gone" }, mic: { access: "granted", devices, defaultId: "h", level: still(0) } })
    expect(button(/AirPods Pro/)).toBeTruthy()
  })
})

const recordingTab = {
  recording: true as const,
  source: "tab" as const,
  tabId: 1,
  elapsedMs: 12_000,
  paused: false,
  logs: true,
  counts: { errors: 1, failedRequests: 0, actions: 9 },
}

describe("while recording", () => {
  test("REC, what is recorded, the timer, the counts, and the tiles disabled", () => {
    view({ live: recordingTab, activeTabId: 1 })
    expect(screen.getByText("REC")).toBeTruthy()
    expect(screen.getByText("Recording this tab")).toBeTruthy()
    expect(screen.getByText("00:12")).toBeTruthy()
    expect(screen.getByText("1 error")).toBeTruthy()
    expect(screen.getByText("0 failed req.")).toBeTruthy()
    expect(screen.getByText("9 actions")).toBeTruthy()
    expect(radio("Visible area").disabled).toBe(true)
    expect(radio("Tab").checked).toBe(true)
    expect(screen.queryByRole("button", { name: "Capture visible area" })).toBeNull()
    expect(screen.getByText("Closing this popup keeps recording. The bar on the page has the same controls.")).toBeTruthy()
    expect(screen.getByText("Capturing console and network live")).toBeTruthy()
  })

  test("the controls", () => {
    const props = view({ live: recordingTab })
    fireEvent.click(button("Stop and review"))
    expect(props.onStop).toHaveBeenCalledTimes(1)
    fireEvent.click(button("Pause"))
    expect(props.onPause).toHaveBeenCalledTimes(1)
    fireEvent.click(button("Restart"))
    expect(props.onRestart).toHaveBeenCalledTimes(1)
    fireEvent.click(button("Discard"))
    expect(props.onDiscard).toHaveBeenCalledTimes(1)
  })

  test("paused: Resume", () => {
    const props = view({ live: { ...recordingTab, paused: true } })
    fireEvent.click(button("Resume"))
    expect(props.onResume).toHaveBeenCalledTimes(1)
  })

  test("another tab, and a screen", () => {
    view({ live: recordingTab, activeTabId: 2 })
    expect(screen.getByText("Recording another tab")).toBeTruthy()
  })

  test("a recording without logs says Logs off", () => {
    view({ live: { ...recordingTab, logs: false } })
    expect(screen.getByText("Logs aren't available on this page")).toBeTruthy()
    expect(screen.getByText("Logs off")).toBeTruthy()
    expect(screen.queryByText("Capturing console and network live")).toBeNull()
  })

  test("until the recording status is known, neither the dial nor Stop shows", () => {
    view({ live: undefined })
    expect(screen.queryByRole("button", { name: "Capture visible area" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Stop and review" })).toBeNull()
    expect(radio("Visible area")).toBeTruthy()
  })

  test("signed out still shows the running recording", () => {
    view({ live: { ...recordingTab, source: "screen" }, session: { kind: "signed-out" } })
    expect(screen.getByText("Recording your screen")).toBeTruthy()
    expect(radio("Screen").checked).toBe(true)
  })
})

describe("the level meter", () => {
  const granted = { access: "granted" as const, devices: [], defaultId: "a", level: still(0) }
  const idle = { recording: false as const }

  test("listens while the picker is open or a microphone is chosen, on a record tile", () => {
    expect(micMeterOn(record("tab"), granted, true, idle, true)).toBe(true)
    expect(micMeterOn({ ...record("tab"), mic: true }, granted, false, idle, true)).toBe(true)
    expect(micMeterOn(record("tab"), granted, false, idle, true)).toBe(false)
  })

  test("off on a screenshot tile, where no chip shows it", () => {
    expect(micMeterOn({ ...DEFAULT_CAPTURE_PREFS, mic: true }, granted, false, idle, true)).toBe(false)
  })

  test("off while recording, and until the recording status is known", () => {
    const prefs = { ...record("tab"), mic: true }
    expect(micMeterOn(prefs, granted, false, recordingTab, true)).toBe(false)
    expect(micMeterOn(prefs, granted, false, undefined, true)).toBe(false)
  })

  test("off without microphone access", () => {
    expect(micMeterOn({ ...record("tab"), mic: true }, { ...granted, access: "prompt" }, true, idle, true)).toBe(false)
  })
})

test("the level bars follow the meter without the popup re-rendering", () => {
  let value = 0
  const listeners = new Set<() => void>()
  const level = { get: () => value, subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)) }
  view({ prefs: { ...record("tab"), mic: true, micDeviceId: "a" }, mic: { access: "granted", devices, defaultId: "a", level } })
  const lit = () => document.querySelectorAll("[data-level-bar='on']").length
  expect(lit()).toBe(0)
  act(() => {
    value = 1
    for (const listener of listeners) listener()
  })
  expect(lit()).toBe(4)
})

describe("camera picker", () => {
  test("the Camera chip shows only for a tab", () => {
    view({ prefs: record("tab") })
    expect(button(/Camera off/)).toBeTruthy()
    cleanup()
    view({ prefs: record("screen") })
    expect(screen.queryByRole("button", { name: /Camera/ })).toBeNull()
    cleanup()
    view({ prefs: record("tab"), tabRecorder: false })
    expect(screen.queryByRole("button", { name: /Camera/ })).toBeNull()
  })

  test("picking a camera, and No camera", () => {
    const props = view({ prefs: record("tab") })
    fireEvent.click(button(/Camera off/))
    fireEvent.click(radio(/FaceTime HD/))
    expect(props.onCameraChoose).toHaveBeenCalledWith("cam1")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("No camera turns it off", () => {
    const props = view({ prefs: { ...record("tab"), camera: true, cameraDeviceId: "cam1" } })
    fireEvent.click(button(/FaceTime HD/))
    fireEvent.click(radio(/No camera/))
    expect(props.onCameraChoose).toHaveBeenCalledWith(null)
  })

  test("the shape is chosen while the camera is on", () => {
    const props = view({ prefs: { ...record("tab"), camera: true, cameraDeviceId: "cam1" } })
    fireEvent.click(button(/FaceTime HD/))
    expect(radio("Circle").checked).toBe(true)
    fireEvent.click(radio("Rectangle"))
    expect(props.onPrefs).toHaveBeenCalledWith({ cameraShape: "rectangle" })
    cleanup()
    view({ prefs: record("tab") })
    fireEvent.click(button(/Camera off/))
    expect(screen.queryByRole("radiogroup", { name: "Shape" })).toBeNull()
  })

  test("a chosen camera that is gone shows the first one's name", () => {
    view({ prefs: { ...record("tab"), camera: true, cameraDeviceId: "gone" } })
    expect(button(/FaceTime HD/)).toBeTruthy()
  })

  test("before access, the picker offers to allow it", () => {
    const props = view({ prefs: record("tab"), camera: { access: "prompt", devices: [] } })
    fireEvent.click(button(/Camera off/))
    expect(screen.queryByRole("radio", { name: /FaceTime HD/ })).toBeNull()
    fireEvent.click(button(/Allow camera access/))
    expect(props.onCameraAllow).toHaveBeenCalledTimes(1)
  })

  test("access blocked: an instruction instead of Allow", () => {
    view({ prefs: record("tab"), camera: { access: "denied", devices: [] } })
    fireEvent.click(button(/Camera off/))
    expect(screen.getByText("Camera is blocked. Allow it for BugBerry in Chrome's site settings.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Allow camera access/ })).toBeNull()
  })

  test("opening one picker closes the other", () => {
    view({ prefs: record("tab") })
    fireEvent.click(button(/Mic off/))
    fireEvent.click(button(/Camera off/))
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByRole("dialog", { name: "Camera" })).toBeTruthy()
  })
})
