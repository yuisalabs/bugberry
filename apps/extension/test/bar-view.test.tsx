import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { barContent, barStatusFrom } from "../entrypoints/recorder-bar/App"
import { BarView, type BarViewProps } from "../entrypoints/recorder-bar/BarView"

const RUNNING = { recording: true, elapsedMs: 42_000, paused: false, errors: 2, micOn: false, micAvailable: true, maxMs: null }

function view(overrides: Partial<BarViewProps> = {}) {
  const props: BarViewProps = {
    status: RUNNING,
    drawing: false,
    tool: "pen",
    onPause: mock(),
    onResume: mock(),
    onMic: mock(),
    onDraw: mock(),
    onTool: mock(),
    onClear: mock(),
    onRestart: mock(),
    onDiscard: mock(),
    onStop: mock(),
    onEscape: mock(),
    ...overrides,
  }
  const rendered = render(<BarView {...props} />)
  return { props, ...rendered }
}

const button = (name: string | RegExp) => screen.getByRole("button", { name })

/** The tooltip a control shows when it gets keyboard focus (hover shows the same one after a short delay). */
async function hintFor(control: HTMLElement): Promise<string | null> {
  fireEvent.keyDown(document.body, { key: "Tab" })
  await act(async () => control.focus())
  return (await screen.findByRole("tooltip")).textContent
}

describe("status", () => {
  test("the timer and the errors caught", () => {
    view()
    expect(screen.getByText("00:42")).toBeTruthy()
    expect(screen.getByText("2 errors caught")).toBeTruthy()
  })

  test("under a length limit, the timer shows it, and stands out in the last 15 seconds", () => {
    const early = view({ status: { ...RUNNING, maxMs: 120_000 } })
    const timer = screen.getByText("00:42 / 02:00")
    expect(timer.hasAttribute("data-ending")).toBe(false)
    early.unmount()
    view({ status: { ...RUNNING, elapsedMs: 105_000, maxMs: 120_000 } })
    expect(screen.getByText("01:45 / 02:00").hasAttribute("data-ending")).toBe(true)
  })

  test("one error; with none, the bar says nothing about errors", () => {
    const first = view({ status: { ...RUNNING, errors: 1 } })
    expect(screen.getByText("1 error caught")).toBeTruthy()
    first.unmount()
    view({ status: { ...RUNNING, errors: 0 } })
    expect(screen.queryByText(/error/)).toBeNull()
  })

  test("a toggle that is on is drawn in the brand colour", () => {
    view({ status: { ...RUNNING, micOn: true } })
    expect(button(/Microphone/).className).toContain("selected:bg-primary")
  })
})

describe("controls", () => {
  test("pause, and resume while paused", () => {
    const { props } = view()
    fireEvent.click(button("Pause"))
    expect(props.onPause).toHaveBeenCalledTimes(1)
  })

  test("while paused the button resumes and the dot stops pulsing", () => {
    const { props, container } = view({ status: { ...RUNNING, paused: true } })
    fireEvent.click(button("Resume"))
    expect(props.onResume).toHaveBeenCalledTimes(1)
    expect(container.querySelector("[data-dot]")?.className).not.toContain("animate-pulse")
  })

  test("the microphone needs permission first: it says why, and a click does nothing", async () => {
    const { props } = view({ status: { ...RUNNING, micAvailable: false } })
    const mic = button(/Microphone/)
    // Not disabled outright: a disabled button can't show its tooltip.
    expect(mic.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(mic)
    expect(props.onMic).not.toHaveBeenCalled()
    expect(await hintFor(mic)).toBe("Allow the microphone in BugBerry first")
  })

  test("every icon button shows its name in a tooltip, not the browser's", async () => {
    view()
    for (const [name, hint] of [
      ["Pause", "Pause"],
      ["Microphone", "Turn the microphone on"],
      ["Draw", "Draw"],
      ["Restart", "Restart"],
      ["Discard", "Discard"],
    ] as const) {
      const control = button(name)
      expect(control.closest("[title]")).toBeNull()
      expect(await hintFor(control)).toBe(hint)
      await act(async () => control.blur())
    }
  })

  test("while a tooltip shows, the bar makes room above itself for it", async () => {
    const { container } = view()
    expect(container.querySelector("[data-hint-room]")).toBeNull()
    await hintFor(button("Pause"))
    expect(container.querySelector("[data-hint-room]")).toBeTruthy()
  })

  test("the room grows above a bar held to the frame's bottom, so the bar never moves under the pointer", async () => {
    const { container } = view()
    const frame = container.querySelector("[data-bar-frame]") as HTMLElement
    expect(frame.className).toContain("h-screen")
    expect(frame.className).toContain("justify-end")
    await hintFor(button("Pause"))
    // The page sizes the iframe to the content, measured apart from the frame-high box around it.
    const content = barContent(document)
    expect(content.hasAttribute("data-bar-content")).toBe(true)
    expect(content.querySelector("[data-hint-room]")).toBeTruthy()
    expect(screen.getByRole("tooltip").getAttribute("data-placement")).toBe("top")
  })

  test("Mic on is pressed; a click turns it off", () => {
    const { props } = view({ status: { ...RUNNING, micOn: true } })
    const mic = button(/Microphone/)
    expect(mic.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(mic)
    expect(props.onMic).toHaveBeenCalledWith(false)
  })

  test("Restart asks first; Cancel does nothing", () => {
    const { props } = view()
    fireEvent.click(button("Restart"))
    expect(screen.getByText("Delete this recording and start over?")).toBeTruthy()
    fireEvent.click(button("Cancel"))
    expect(screen.queryByText("Delete this recording and start over?")).toBeNull()
    expect(props.onRestart).not.toHaveBeenCalled()
    fireEvent.click(button("Restart"))
    fireEvent.click(button("Delete"))
    expect(props.onRestart).toHaveBeenCalledTimes(1)
  })

  test("Discard asks first", () => {
    const { props } = view()
    fireEvent.click(button("Discard"))
    expect(screen.getByText("Delete this recording?")).toBeTruthy()
    fireEvent.click(button("Delete"))
    expect(props.onDiscard).toHaveBeenCalledTimes(1)
  })

  test("Draw opens the tools", () => {
    const first = view()
    fireEvent.click(button("Draw"))
    expect(first.props.onDraw).toHaveBeenCalledWith(true)
    first.unmount()
    const { props } = view({ drawing: true })
    for (const name of ["Pen", "Arrow", "Circle", "Note", "Clear"]) expect(button(name)).toBeTruthy()
    fireEvent.click(button("Note"))
    expect(props.onTool).toHaveBeenCalledWith("note")
    fireEvent.click(button("Clear"))
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })

  test("Stop, with no stop shortcut hint", () => {
    const { props } = view()
    fireEvent.click(button("Stop"))
    expect(props.onStop).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/to stop/)).toBeNull()
  })
})

describe("Esc", () => {
  test("leaves Draw first", () => {
    const { props } = view({ drawing: true })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(props.onDraw).toHaveBeenCalledWith(false)
    expect(props.onEscape).not.toHaveBeenCalled()
  })

  test("otherwise goes to the page (it cancels a countdown)", () => {
    const { props } = view()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(props.onEscape).toHaveBeenCalledTimes(1)
  })

  test("closes an open confirmation without deleting", () => {
    const { props } = view()
    fireEvent.click(button("Discard"))
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByText("Delete this recording?")).toBeNull()
    expect(props.onDiscard).not.toHaveBeenCalled()
  })
})

test("only a real status answer reaches the bar", () => {
  expect(barStatusFrom({ ok: false, error: "Not the recorded tab" })).toBeNull()
  expect(barStatusFrom(undefined)).toBeNull()
  expect(barStatusFrom(RUNNING)).toEqual(RUNNING)
})
