import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { REPORT_LIST_REFRESH_MS, reportQueries } from "../src/features/reports/queries"
import { fakeFetch, restoreFetch } from "./support/fake-fetch"

afterEach(restoreFetch)

describe("report list query", () => {
  test("refreshes well within the default signed-link lifetime, so a page left open keeps working previews", () => {
    const options = reportQueries.reportFeed("w1", { sort: "newest" })
    expect(options.refetchInterval).toBe(REPORT_LIST_REFRESH_MS)
    expect(REPORT_LIST_REFRESH_MS).toBeLessThanOrEqual(10 * 60_000)
  })

  test("the first part is asked for without a cursor, the next with the one the server gave", async () => {
    const { requests } = fakeFetch((request) =>
      Response.json({ items: [], nextCursor: new URL(request.url).searchParams.has("cursor") ? null : "abc" }),
    )
    const client = new QueryClient()
    const options = reportQueries.reportFeed("w1", { sort: "newest" })
    await client.fetchInfiniteQuery({ ...options, pages: 3 })
    const sent = requests.map((request) => new URL(request.url).searchParams)
    expect(sent.map((params) => params.get("cursor"))).toEqual([null, "abc"])
    expect(sent.every((params) => !params.has("page") && params.get("perPage") === "9")).toBe(true)
  })
})

describe("the count of a whole list", () => {
  test("comes from the status counts of the workspace, or of one project", async () => {
    const { requests } = fakeFetch(() => Response.json({ total: 128, byStatus: { open: 100, in_progress: 8, resolved: 20, closed: 0 } }))
    const client = new QueryClient()
    expect(await client.fetchQuery(reportQueries.reportCount("w1", "p1"))).toBe(128)
    expect(await client.fetchQuery(reportQueries.reportCount("w1"))).toBe(128)
    const [one, all] = requests.map((request) => new URL(request.url))
    expect(one?.pathname).toBe("/api/reports/counts")
    expect(one?.searchParams.get("projectId")).toBe("p1")
    expect(one?.searchParams.get("workspaceId")).toBe("w1")
    expect(all?.searchParams.has("projectId")).toBe(false)
  })
})
