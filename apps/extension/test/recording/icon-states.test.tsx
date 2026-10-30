import { describe, expect, test } from "bun:test"
import {
  RiArrowRightUpFill,
  RiPencilFill,
  RiPencilLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { render, screen } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { BarView, type BarViewProps } from "../../entrypoints/recorder-bar/BarView"

/** The shape an icon draws, to tell its line and fill variants apart. */
const shape = (Icon: RemixiconComponentType) => renderToStaticMarkup(<Icon />).match(/ d="([^"]+)"/)?.[1] ?? "none"
const draws = (element: Element, Icon: RemixiconComponentType) => element.innerHTML.includes(shape(Icon))
const noop = () => {}

function bar(overrides: Partial<BarViewProps>) {
  const props: BarViewProps = {
    status: { recording: true, elapsedMs: 0, paused: false, errors: 0, micOn: false, micAvailable: true, maxMs: null },
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
})
