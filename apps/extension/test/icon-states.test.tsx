import { describe, expect, test } from "bun:test"
import {
  RiArrowRightUpFill,
  RiComputerFill,
  RiComputerLine,
  RiLayoutTopFill,
  RiPencilFill,
  RiPencilLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { fireEvent, render, screen } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { DEFAULT_CAPTURE_PREFS } from "../lib/capture-prefs"
import { PopupView, type PopupViewProps } from "../entrypoints/popup/PopupView"
import { BarView, type BarViewProps } from "../entrypoints/recorder-bar/BarView"

/** The shape an icon draws, to tell its line and fill variants apart. */
const shape = (Icon: RemixiconComponentType) => renderToStaticMarkup(<Icon />).match(/ d="([^"]+)"/)?.[1] ?? "none"
const draws = (element: Element, Icon: RemixiconComponentType) => element.innerHTML.includes(shape(Icon))
const noop = () => {}

function bar(overrides: Partial<BarViewProps>) {
  const props: BarViewProps = {
    status: { recording: true, elapsedMs: 0, paused: false, errors: 0, micOn: false, micAvailable: true },
    mac: false,
    drawing: false,
    tool: "pen",
    onPause: noop,
    onResume: noop,
    onMic: noop,
    onDraw: noop,
    onTool: noop,
    onClear: noop,
    onRestart: noop,
    onDiscard: noop,
    onStop: noop,
    onEscape: noop,
    ...overrides,
  }
  return render(<BarView {...props} />)
}

describe("icons are line, and fill for what is chosen", () => {
  test("the Draw button is filled while drawing, and so is the chosen tool", () => {
    const { unmount } = bar({})
    expect(draws(screen.getByRole("button", { name: "Draw" }), RiPencilLine)).toBe(true)
    unmount()
    bar({ drawing: true, tool: "arrow" })
    expect(draws(screen.getByRole("button", { name: "Draw" }), RiPencilFill)).toBe(true)
    expect(draws(screen.getByRole("button", { name: "Arrow" }), RiArrowRightUpFill)).toBe(true)
    expect(draws(screen.getByRole("button", { name: "Pen" }), RiPencilLine)).toBe(true)
  })

  test("the chosen thing to record is filled", () => {
    const props = { prefs: { ...DEFAULT_CAPTURE_PREFS, recordSource: "screen" } } as Partial<PopupViewProps>
    render(
      <PopupView
        {...({
          session: { kind: "signed-in", name: "Ana", email: "ana@kantor.test" },
          serverHost: "bugberry.kantor.com",
          micLabel: "Mic",
          screenshotShortcut: "Alt+Shift+C",
          recording: { recording: false },
          drafts: [],
          logsAvailable: true,
          tabRecorder: true,
          hostAccess: true,
          error: null,
          busy: false,
          onPrefs: noop,
          onMicToggle: noop,
          onScreenshot: noop,
          onRecord: noop,
          onSignIn: noop,
          onRetry: noop,
          onOpenSettings: noop,
          onOpenDashboard: noop,
          onOpenDraft: noop,
          onDeleteDraft: noop,
          onAllowHosts: noop,
          ...props,
        } as PopupViewProps)}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Record options" }))
    expect(draws(screen.getByRole("radio", { name: "Screen" }), RiComputerFill)).toBe(true)
    expect(draws(screen.getByRole("radio", { name: "This tab" }), RiLayoutTopFill)).toBe(false)
    // The Record row shows the chosen source in line, like every other row.
    expect(draws(screen.getByRole("button", { name: /^Record screen/ }), RiComputerLine)).toBe(true)
  })
})
