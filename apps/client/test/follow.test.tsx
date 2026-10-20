import { describe, expect, mock, test } from "bun:test"
import { render } from "@testing-library/react"
import { ActionsTab } from "../src/components/debugger/ActionsTab"
import { nextScrollTop, useFollow } from "../src/components/debugger/useFollow"
import { normalizePayload } from "@bugberry/debugger-view"

describe("nextScrollTop", () => {
  const panel = { scrollTop: 100, height: 300 }

  test("leaves a visible row alone", () => {
    expect(nextScrollTop(panel, { top: 40, bottom: 80 })).toBeNull()
  })

  test("scrolls the panel just enough to show a row above or below", () => {
    expect(nextScrollTop(panel, { top: -30, bottom: 10 })).toBe(70)
    expect(nextScrollTop(panel, { top: 290, bottom: 330 })).toBe(130)
  })

  test("a row under a sticky header counts as hidden, and comes out just below it", () => {
    const withHeader = { ...panel, covered: 28 }
    expect(nextScrollTop(withHeader, { top: 40, bottom: 80 })).toBeNull()
    expect(nextScrollTop(withHeader, { top: 10, bottom: 50 })).toBe(82)
    expect(nextScrollTop(withHeader, { top: 290, bottom: 330 })).toBe(130)
  })
})

describe("following the playhead", () => {
  test("never scrolls the page itself", () => {
    const scrollIntoView = mock()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    try {
      const { events } = normalizePayload({
        recordingStartedAt: 1000,
        events: [
          { kind: "action", t: 2000, type: "click", target: "a" },
          { kind: "action", t: 3000, type: "click", target: "b" },
        ],
      })
      const { rerender } = render(<ActionsTab events={events} base={1000} playback={{ currentMs: 1000, seek: () => {} }} />)
      rerender(<ActionsTab events={events} base={1000} playback={{ currentMs: 2500, seek: () => {} }} />)
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })
})

describe("useFollow refs", () => {
  test("each row keeps one ref across renders, so memoized rows are not redrawn for a new one", () => {
    const seen: Array<(element: HTMLElement | null) => void> = []
    function List({ active }: { active: number }) {
      const follow = useFollow(active)
      seen.push(follow(0))
      return <li ref={follow(0)}>row</li>
    }
    const { rerender } = render(<List active={-1} />)
    rerender(<List active={0} />)
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })
})
