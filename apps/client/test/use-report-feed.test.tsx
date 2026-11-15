import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import type { ReportFeed, ReportFilterQuery } from "../src/features/reports/list/report-feed"
import { useReportFeed } from "../src/features/reports/list/useReportFeed"
import { listItemFixture } from "./fixtures"
import { fakeFetch, restoreFetch } from "./support/fake-fetch"

afterEach(restoreFetch)

const COUNTS = { total: 9, byStatus: { open: 6, in_progress: 1, resolved: 2, closed: 0 } }

/**
 * A server with two parts of two reports each. Every request is recorded as "list", "list:<cursor>" or "counts";
 * `hold(name)` keeps the next request of that name waiting until the returned function is called.
 */
function fakeServer() {
  const seen: string[] = []
  const held = new Map<string, Promise<void>>()
  fakeFetch(async (request) => {
    const url = new URL(request.url)
    const cursor = url.searchParams.get("cursor")
    const name = url.pathname.endsWith("/counts") ? "counts" : cursor ? `list:${cursor}` : "list"
    seen.push(name)
    const wait = held.get(name)
    if (wait) {
      held.delete(name)
      await wait
    }
    if (name === "counts") return Response.json(url.searchParams.get("q") === "zebra" ? { ...COUNTS, total: 2 } : COUNTS)
    if (url.searchParams.get("q") === "nothing") return Response.json({ items: [], nextCursor: null })
    return cursor
      ? Response.json({ items: [listItemFixture({ id: "c" }), listItemFixture({ id: "d" })], nextCursor: null })
      : Response.json({ items: [listItemFixture({ id: "a" }), listItemFixture({ id: "b" })], nextCursor: "next" })
  })
  return {
    seen,
    hold(name: string) {
      let release = () => {}
      held.set(name, new Promise<void>((resolve) => (release = resolve)))
      return release
    },
  }
}

function renderFeed(initial: ReportFilterQuery = { sort: "newest" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(({ filters }) => useReportFeed("w1", filters, true), { wrapper, initialProps: { filters: initial } })
}

/** The loaded feed; fails the test while the list is loading or in error. */
function feedOf(result: { current: ReturnType<typeof useReportFeed> }): ReportFeed {
  const { list } = result.current
  if (typeof list !== "object" || !("items" in list)) throw new Error(`no feed yet: ${JSON.stringify(list)}`)
  return list
}

describe("the report feed's wiring", () => {
  test("the total is added up from the status counts, for the statuses picked", async () => {
    fakeServer()
    const all = renderFeed()
    await waitFor(() => expect(feedOf(all.result).total).toBe(9))
    expect(feedOf(all.result).items.map((item) => item.id)).toEqual(["a", "b"])
    expect(all.result.current.statusCounts).toEqual(COUNTS)
    const open = renderFeed({ sort: "newest", status: ["open", "resolved"] })
    await waitFor(() => expect(feedOf(open.result).total).toBe(8))
  })

  test("after the filters change, the old total is not shown beside the new list", async () => {
    const server = fakeServer()
    const { result, rerender } = renderFeed()
    await waitFor(() => expect(feedOf(result).total).toBe(9))
    const release = server.hold("counts")
    rerender({ filters: { sort: "newest", q: "zebra" } })
    await waitFor(() => expect(server.seen.filter((name) => name === "list")).toHaveLength(2))
    await waitFor(() => expect(feedOf(result).refreshing).toBe(false))
    expect(feedOf(result).total).toBeNull()
    // The chips keep the counts of the filters before until the new ones arrive.
    expect(result.current.statusCounts).toEqual(COUNTS)
    release()
    await waitFor(() => expect(feedOf(result).total).toBe(2))
  })

  test("a first part that comes back empty is reported as empty", async () => {
    fakeServer()
    const none = renderFeed({ sort: "newest", q: "nothing" })
    await waitFor(() => expect(none.result.current.empty).toBe(true))
    const some = renderFeed()
    await waitFor(() => expect(feedOf(some.result).items).toHaveLength(2))
    expect(some.result.current.empty).toBe(false)
  })

  test("the next part is not refreshing; fetching the shown parts again is", async () => {
    const server = fakeServer()
    const { result } = renderFeed()
    await waitFor(() => expect(feedOf(result).total).toBe(9))
    const releaseNext = server.hold("list:next")
    act(() => result.current.loadMore())
    await waitFor(() => expect(feedOf(result).loadingMore).toBe(true))
    expect(feedOf(result).refreshing).toBe(false)
    releaseNext()
    await waitFor(() => expect(feedOf(result).items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]))

    const releaseAgain = server.hold("list")
    act(() => result.current.refreshPreviews())
    await waitFor(() => expect(feedOf(result).refreshing).toBe(true))
    expect(feedOf(result).loadingMore).toBe(false)
    releaseAgain()
    await waitFor(() => expect(feedOf(result).refreshing).toBe(false))
  })

  test("previews that fail while the next part loads do not cancel it; fresh links are fetched once, after", async () => {
    const server = fakeServer()
    const { result } = renderFeed()
    await waitFor(() => expect(feedOf(result).total).toBe(9))
    const release = server.hold("list:next")
    act(() => result.current.loadMore())
    await waitFor(() => expect(feedOf(result).loadingMore).toBe(true))
    act(() => {
      result.current.refreshPreviews()
      result.current.refreshPreviews()
      result.current.refreshPreviews()
    })
    expect(feedOf(result).loadingMore).toBe(true)
    release()
    await waitFor(() => expect(server.seen.filter((name) => name !== "counts")).toEqual(["list", "list:next", "list", "list:next"]))
    await waitFor(() => expect(feedOf(result).refreshing).toBe(false))
    expect(feedOf(result).items.map((item) => item.id)).toEqual(["a", "b", "c", "d"])
  })

  test("several previews failing at once cost one refetch", async () => {
    const server = fakeServer()
    const { result } = renderFeed()
    await waitFor(() => expect(feedOf(result).total).toBe(9))
    act(() => {
      result.current.refreshPreviews()
      result.current.refreshPreviews()
    })
    await waitFor(() => expect(server.seen.filter((name) => name === "list")).toHaveLength(2))
    await waitFor(() => expect(feedOf(result).refreshing).toBe(false))
    expect(server.seen.filter((name) => name === "list")).toHaveLength(2)
  })
})
