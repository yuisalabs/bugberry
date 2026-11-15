import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { LoadMore } from "../src/features/reports/list/LoadMore"
import { REPORT_LIST_REFRESH_MS, reportQueries } from "../src/features/reports/queries"
import { feedItems, feedTotal, nextReportsCursor, REPORTS_PAGE_SIZE, reportsPageQuery } from "../src/features/reports/list/report-feed"
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
    expect(reportsPageQuery({ sort: "newest", status: ["open"] }, null)).toEqual({ sort: "newest", status: ["open"], perPage: 9 })
    expect(reportsPageQuery({ sort: "newest" }, "abc")).toEqual({ sort: "newest", perPage: 9, cursor: "abc" })
  })

  test("there is a next part only while the server names one", () => {
    expect(nextReportsCursor({ items: [], nextCursor: "abc" })).toBe("abc")
    expect(nextReportsCursor({ items: [], nextCursor: null })).toBeUndefined()
  })

  test("a report that moved into the next part (a new one arrived meanwhile) is listed once", () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => listItemFixture({ id }))
    const pages = [
      { items: [a, b], nextCursor: "x" },
      { items: [b, c], nextCursor: null },
    ]
    expect(feedItems(pages as never).map((item) => item.id)).toEqual(["a", "b", "c"])
  })

  test("the total is the counts of the picked statuses, and unknown while the counts on hand are for other filters", () => {
    const data = { total: 9, byStatus: { open: 6, in_progress: 1, resolved: 2, closed: 0 } }
    expect(feedTotal({ data, isPlaceholderData: false })).toBe(9)
    expect(feedTotal({ data, isPlaceholderData: false }, ["open", "resolved"])).toBe(8)
    // The new filters' list arrives before their counts: the old number would sit beside the new reports.
    expect(feedTotal({ data, isPlaceholderData: true })).toBeNull()
    expect(feedTotal({ data: undefined, isPlaceholderData: false })).toBeNull()
  })

  test("the query starts without a cursor, follows nextReportsCursor, and keeps the previews fresh", () => {
    const options = reportQueries.reportFeed("w1", { sort: "newest" })
    expect(options.initialPageParam).toBeNull()
    expect(options.getNextPageParam).toBe(nextReportsCursor)
    expect(options.refetchInterval).toBe(REPORT_LIST_REFRESH_MS)
    expect([...options.queryKey]).toEqual(["reports", "w1", { sort: "newest" }])
  })
})

describe("LoadMore", () => {
  const props = { shown: 9, hasMore: true, loading: false, failed: false }

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

  test("a list of one says report, not reports", () => {
    render(<LoadMore {...props} shown={1} hasMore={false} onLoadMore={() => {}} />)
    expect(screen.getByText("All 1 report shown")).toBeTruthy()
  })

  test("it stops watching when it goes away", () => {
    const { unmount } = render(<LoadMore {...props} onLoadMore={() => {}} />)
    unmount()
    expect(live()).toHaveLength(0)
  })
})
