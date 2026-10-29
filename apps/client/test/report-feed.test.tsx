import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { LoadMore } from "../src/components/LoadMore"
import { queries } from "../src/lib/queries"
import { REPORT_LIST_REFRESH_MS } from "../src/features/reports/queries"
import { feedItems, nextReportsPage, REPORTS_PAGE_SIZE, reportsPageQuery } from "../src/lib/report-feed"
import { listItemFixture } from "./fixtures"

/**
 * Stands in for the browser's IntersectionObserver. `reach()` tells the newest one that the end of the list came
 * into view, even after it was disconnected, as entries already queued would.
 */
class FakeObserver {
  static all: FakeObserver[] = []
  target: Element | null = null
  live = true
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this)
  }
  observe(target: Element) {
    this.target = target
  }
  unobserve() {}
  disconnect() {
    this.live = false
  }
  takeRecords() {
    return []
  }
}
const live = () => FakeObserver.all.filter((observer) => observer.live)
function reach(visible = true) {
  const observer = FakeObserver.all.at(-1)
  if (!observer?.target) throw new Error("nothing is watching the end of the list")
  observer.callback([{ isIntersecting: visible, target: observer.target } as IntersectionObserverEntry], observer as never)
}

const original = globalThis.IntersectionObserver
beforeEach(() => {
  FakeObserver.all = []
  globalThis.IntersectionObserver = FakeObserver as never
})
afterEach(() => {
  globalThis.IntersectionObserver = original
})

describe("the report feed", () => {
  test("asks for 9 reports at a time", () => {
    expect(REPORTS_PAGE_SIZE).toBe(9)
    expect(reportsPageQuery({ sort: "newest", status: ["open"] }, 3)).toEqual({ sort: "newest", status: ["open"], page: 3, perPage: 9 })
  })

  test("there is a next part only while reports are left", () => {
    expect(nextReportsPage({ items: [], page: 1, perPage: 9, total: 20 })).toBe(2)
    expect(nextReportsPage({ items: [], page: 2, perPage: 9, total: 20 })).toBe(3)
    expect(nextReportsPage({ items: [], page: 3, perPage: 9, total: 20 })).toBeUndefined()
    expect(nextReportsPage({ items: [], page: 1, perPage: 9, total: 9 })).toBeUndefined()
    expect(nextReportsPage({ items: [], page: 1, perPage: 9, total: 0 })).toBeUndefined()
  })

  test("a report that moved into the next part (a new one arrived meanwhile) is listed once", () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => listItemFixture({ id }))
    const pages = [
      { items: [a, b], page: 1, perPage: 2, total: 3 },
      { items: [b, c], page: 2, perPage: 2, total: 3 },
    ]
    expect(feedItems(pages as never).map((item) => item.id)).toEqual(["a", "b", "c"])
  })

  test("the query starts at part 1, follows nextReportsPage, and keeps the previews fresh", () => {
    const options = queries.reportFeed("w1", { sort: "newest" })
    expect(options.initialPageParam).toBe(1)
    expect(options.getNextPageParam).toBe(nextReportsPage)
    expect(options.refetchInterval).toBe(REPORT_LIST_REFRESH_MS)
    expect([...options.queryKey]).toEqual(["reports", "w1", { sort: "newest" }])
  })
})

describe("LoadMore", () => {
  const props = { shown: 9, total: 20, hasMore: true, loading: false, failed: false }

  test("reaching the end of the list asks for the next part once, however often it is seen", () => {
    const onLoadMore = mock()
    render(<LoadMore {...props} onLoadMore={onLoadMore} />)
    reach(false)
    expect(onLoadMore).not.toHaveBeenCalled()
    reach()
    reach()
    reach()
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  test("while a part is loading nothing more is asked for", () => {
    const onLoadMore = mock()
    render(<LoadMore {...props} loading onLoadMore={onLoadMore} />)
    expect(live()).toHaveLength(0)
    expect(screen.getByRole("status").textContent).toContain("Loading more reports")
  })

  test("when the part arrives and the end is still in view, the next one is asked for", () => {
    const onLoadMore = mock()
    const { rerender } = render(<LoadMore {...props} onLoadMore={onLoadMore} />)
    reach()
    rerender(<LoadMore {...props} loading onLoadMore={onLoadMore} />)
    rerender(<LoadMore {...props} shown={18} onLoadMore={onLoadMore} />)
    expect(live()).toHaveLength(1)
    reach()
    expect(onLoadMore).toHaveBeenCalledTimes(2)
  })

  test("a part that failed is not asked for again by itself; Try again asks once", () => {
    const onLoadMore = mock()
    render(<LoadMore {...props} failed onLoadMore={onLoadMore} />)
    expect(live()).toHaveLength(0)
    expect(screen.getByText("Couldn't load more reports.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  test("with everything shown it stops watching and says so", () => {
    const onLoadMore = mock()
    render(<LoadMore {...props} shown={20} hasMore={false} onLoadMore={onLoadMore} />)
    expect(live()).toHaveLength(0)
    expect(screen.getByText("All 20 reports shown")).toBeTruthy()
  })

  test("it stops watching when it goes away", () => {
    const { unmount } = render(<LoadMore {...props} onLoadMore={() => {}} />)
    unmount()
    expect(live()).toHaveLength(0)
  })
})
