import { expect, test } from "bun:test"
import { render } from "@testing-library/react"
import { barContent } from "../../entrypoints/recorder-bar/App"
import { BarView } from "../../entrypoints/recorder-bar/BarView"

const noop = () => {}

test("the bar's content sits in the frame's bottom-left corner, so what opens above it grows upwards", () => {
  const { container } = render(
    <BarView
      status={{ recording: true, elapsedMs: 0, paused: false, errors: 0, micOn: false, micAvailable: true, maxMs: null }}
      drawing
      tool="pen"
      onPause={noop}
      onResume={noop}
      onMic={noop}
      onDraw={noop}
      onTool={noop}
      onClear={noop}
      onRestart={noop}
      onDiscard={noop}
      onStop={noop}
      onEscape={noop}
    />,
  )
  const content = container.querySelector("[data-bar-content]") as HTMLElement
  for (const anchor of ["fixed", "bottom-0", "left-0", "w-max"]) expect(content.className).toContain(anchor)
  // The page sizes the iframe to this content: the body around it has no size of its own.
  expect(barContent(document)).toBe(content)
})

test("the bar's page never scrolls: a scrollbar in the frame would push the bar about", async () => {
  const html = await Bun.file(new URL("../../entrypoints/recorder-bar/index.html", import.meta.url)).text()
  expect(html).toMatch(/<html[^>]*overflow:\s*hidden/)
  expect(html).toMatch(/<body[^>]*overflow-hidden/)
})
