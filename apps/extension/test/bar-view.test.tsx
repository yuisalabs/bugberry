import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { barStatusFrom } from "../entrypoints/recorder-bar/App"
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

  test("the microphone needs permission first, and shows when it is on", () => {
    view({ status: { ...RUNNING, micAvailable: false } })
    const mic = button(/Microphone/)
    expect((mic as HTMLButtonElement).disabled).toBe(true)
    expect(mic.closest("[title]")?.getAttribute("title")).toBe("Allow the microphone in BugBerry first")
    // A title on a box of its own: display: contents would show no tooltip.
    expect((mic.closest("[title]") as HTMLElement).className).not.toContain("contents")
  })

  test("every icon button has a hover hint", () => {
    view()
    for (const name of ["Pause", "Microphone", "Draw", "Restart", "Discard"]) {
      expect(button(name).closest("[title]")?.getAttribute("title")).toBeTruthy()
    }
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
