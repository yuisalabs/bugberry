import { afterEach, describe, expect, test } from "bun:test"
import { createApi } from "../src/lib/api"
import { me as fetchMe } from "../src/features/account/queries"
import { createProject } from "../src/features/projects/queries"
import { testIntegration } from "../src/features/integrations/queries"
import { shouldRetry } from "../src/lib/query/client"
import { maintenanceOf } from "../src/lib/status"
import { fakeFetch, restoreFetch } from "./support/fake-fetch"
import { ApiError, errorMessage } from "../src/lib/query/unwrap"
import { reports, sendToTracker } from "../src/features/reports/queries"

const ORIGIN = window.location.origin

afterEach(restoreFetch)

describe("createApi", () => {
  test("calls the API on the page's origin", async () => {
    const { requests } = fakeFetch(() =>
      Response.json({ id: "u1", email: "ana@kantor.test", name: "Ana", image: null, lastWorkspaceId: "w1" }),
    )
    const me = await fetchMe()
    expect(me.name).toBe("Ana")
    expect(requests[0]?.url).toBe(`${ORIGIN}/api/me`)
  })

  test("sends list filters as repeated query parameters", async () => {
    const { requests } = fakeFetch(() => Response.json({ items: [], page: 2, perPage: 20, total: 0 }))
    await reports("w1", {
      projectId: "p1",
      status: ["open", "closed"],
      captureType: "video",
      reporterId: "u1",
      sort: "priority",
      page: 2,
      perPage: 20,
    })
    const url = new URL(requests[0]?.url ?? "")
    expect(url.pathname).toBe("/api/reports")
    expect(url.searchParams.getAll("status")).toEqual(["open", "closed"])
    expect(url.searchParams.get("projectId")).toBe("p1")
    expect(url.searchParams.get("captureType")).toBe("video")
    expect(url.searchParams.get("reporterId")).toBe("u1")
    expect(url.searchParams.get("page")).toBe("2")
    expect(url.searchParams.has("q")).toBe(false)
  })

  test("turns the server's error body into an ApiError", async () => {
    fakeFetch(() =>
      Response.json({ code: "slug_taken", message: "Slug is already used by another project" }, { status: 409 }),
    )
    const error = await createProject("w1", { name: "Web", slug: "web", urlPatterns: [] }).catch((caught) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: "slug_taken" })
  })

  test("calls the comment and tracker endpoints", async () => {
    const { requests } = fakeFetch(() => Response.json({ ok: true }))
    const client = createApi()
    await client.addComment("r1", "Hello")
    await sendToTracker("r1", "i1")
    await testIntegration("p1", "i1")
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /api/reports/r1/comments",
      "POST /api/reports/r1/trackers/i1/send",
      "POST /api/projects/p1/integrations/i1/test",
    ])
    expect(await requests[0]?.json()).toEqual({ body: "Hello" })
  })

  test("a failed fetch becomes a network ApiError", async () => {
    fakeFetch(() => {
      throw new TypeError("Failed to fetch")
    })
    const error = await fetchMe().catch((caught) => caught)
    expect(error).toMatchObject({ status: 0, code: "network" })
  })

  test("a gateway timeout says how long the request waited", async () => {
    fakeFetch(async () => {
      await Bun.sleep(30)
      return new Response("<html>504 Gateway Time-out</html>", { status: 504, headers: { "content-type": "text/html" } })
    })
    const error = await fetchMe().catch((caught) => caught)
    expect(error).toMatchObject({ status: 504 })
    expect(error.waitedMs).toBeGreaterThanOrEqual(25)
  })

  test("nginx's maintenance notice keeps its message and time", async () => {
    const notice = { code: "maintenance", message: "Upgrading the database", until: "2026-10-24T14:30:00Z" }
    fakeFetch(() => Response.json(notice, { status: 503 }))
    const error = await fetchMe().catch((caught) => caught)
    expect(error).toMatchObject({ status: 503, code: "maintenance" })
    // Eden reads the ISO time as a Date; maintenanceOf takes either.
    expect(maintenanceOf(error)).toEqual({ message: "Upgrading the database", until: new Date("2026-10-24T14:30:00Z") })
  })
})

describe("errorMessage", () => {
  test("uses its own text for known codes and the server message otherwise", () => {
    expect(errorMessage(new ApiError(409, "slug_taken", "Slug is already used"))).toBe("Another project already uses this slug")
    expect(errorMessage(new ApiError(400, "something_new", "Server says no"))).toBe("Server says no")
    expect(errorMessage(new Error("boom"))).toBe("boom")
  })
})

describe("shouldRetry", () => {
  test("retries network and server errors twice, never 4xx", () => {
    expect(shouldRetry(0, new ApiError(0, "network", ""))).toBe(true)
    expect(shouldRetry(1, new ApiError(503, "unavailable", ""))).toBe(true)
    expect(shouldRetry(2, new ApiError(503, "unavailable", ""))).toBe(false)
    expect(shouldRetry(0, new ApiError(404, "report_not_found", ""))).toBe(false)
    expect(shouldRetry(0, new ApiError(401, "unauthorized", ""))).toBe(false)
  })
})
