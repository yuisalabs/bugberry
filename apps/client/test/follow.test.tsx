import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { render, waitFor } from "@testing-library/react"
import { ActionsTab } from "../src/components/debugger/ActionsTab"
import { FOLLOW_SCROLL_ATTRIBUTE } from "../src/components/debugger/useVirtualRows"
import { normalizePayload } from "@bugberry/debugger-view"

const realScrollTo = HTMLElement.prototype.scrollTo
const realScrollIntoView = HTMLElement.prototype.scrollIntoView
afterEach(() => {
  HTMLElement.prototype.scrollTo = realScrollTo
  HTMLElement.prototype.scrollIntoView = realScrollIntoView
})

/** 300 clicks a second apart, from 1 s into the recording. */
const { events } = normalizePayload({
  recordingStartedAt: 1000,
  events: Array.from({ length: 300 }, (_, i) => ({ kind: "action", t: 2000 + i * 1000, type: "click", target: `button#b${i}` })),
})

/** The Actions tab inside its scrolling panel, at `currentMs` into the video. */
const tab = (currentMs: number) => (
  <div {...{ [FOLLOW_SCROLL_ATTRIBUTE]: "" }}>
    <ActionsTab events={events} base={1000} playback={{ currentMs, seek: () => {} }} />
  </div>
)

/** The page has no layout here: give the panel the height of its rows, and let scrolling it move it. */
function scrollable(panel: Element) {
  Object.defineProperty(panel, "scrollHeight", { configurable: true, get: () => 300 * 33 })
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    this.scrollTop = typeof options === "number" ? options : (options?.top ?? 0)
    this.dispatchEvent(new Event("scroll"))
  } as typeof HTMLElement.prototype.scrollTo
}

describe("following the playhead", () => {
  test("scrolls the panel to an action far down the list, and never the page itself", () => {
    const scrollIntoView = mock()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const { rerender, container } = render(tab(1000))
    const panel = container.firstElementChild as HTMLElement
    scrollable(panel)
    const scrolled = spyOn(HTMLElement.prototype, "scrollTo")
    rerender(tab(250_500))
    expect(scrolled).toHaveBeenCalled()
    expect(scrolled.mock.contexts.every((element) => element === panel)).toBe(true)
    // The 250th click sits about 250 one-line rows down.
    expect(panel.scrollTop).toBeGreaterThan(200 * 30)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  test("the action being played is drawn, and marked, even far down the list", async () => {
    const { rerender, container } = render(tab(1000))
    scrollable(container.firstElementChild as HTMLElement)
    rerender(tab(250_500))
    await waitFor(() => expect(container.querySelector('[aria-current="true"]')).not.toBeNull())
    const current = container.querySelector('[aria-current="true"]')
    expect(current?.textContent).toContain("button#b249")
    expect(current?.getAttribute("aria-posinset")).toBe("250")
    expect(current?.getAttribute("aria-setsize")).toBe("300")
  })
})
