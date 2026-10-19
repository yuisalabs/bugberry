import { describe, expect, test } from "bun:test"
import {
  hasFilters,
  toggleValue,
  toReportsQuery,
  validateProjectReportSearch,
  validateReportSearch,
} from "../src/lib/report-search"

describe("validateReportSearch", () => {
  test("keeps capture type, reporter and project filters", () => {
    expect(validateReportSearch({ captureType: "video", reporterId: "u1", projectId: "none" })).toMatchObject({
      captureType: "video",
      reporterId: "u1",
      projectId: "none",
    })
    expect(validateReportSearch({ captureType: "gif" }).captureType).toBeUndefined()
  })

  test("the new filters count as filters", () => {
    expect(hasFilters({ captureType: "video" })).toBe(true)
    expect(hasFilters({ reporterId: "u1" })).toBe(true)
    expect(hasFilters({ projectId: "none" })).toBe(true)
  })

  test("keeps valid filters in canonical order", () => {
    expect(
      validateReportSearch({
        status: ["closed", "open", "open"],
        priority: "high,low",
        q: "  checkout ",
        sort: "priority",
        assigneeId: "u1",
      }),
    ).toEqual({
      status: ["open", "closed"],
      priority: ["low", "high"],
      q: "checkout",
      sort: "priority",
      assigneeId: "u1",
    })
  })

  test("an old link's page and page size are dropped: the list loads as it scrolls", () => {
    expect(validateReportSearch({ page: 3, perPage: 50, q: "pay" })).toEqual({ q: "pay" })
  })

  test("drops values the API would reject", () => {
    expect(
      validateReportSearch({ status: ["bogus"], priority: 7, q: "", sort: "bogus" }),
    ).toEqual({})
  })

  test("sort values from old and odd URLs", () => {
    expect(validateReportSearch({ sort: "priority" }).sort).toBe("priority")
    expect(validateReportSearch({ sort: "oldest" }).sort).toBe("oldest")
    expect(validateReportSearch({ sort: "newest" }).sort).toBeUndefined()
    expect(validateReportSearch({ sort: "bogus" }).sort).toBeUndefined()
    expect(toReportsQuery({}, { sort: "oldest" }).sort).toBe("oldest")
  })

  test("numeric search text from the URL stays searchable", () => {
    expect(validateReportSearch({ q: 404 }).q).toBe("404")
  })

  test("caps very long search text", () => {
    expect(validateReportSearch({ q: "x".repeat(500) }).q).toHaveLength(200)
  })
})

describe("validateProjectReportSearch", () => {
  test("a project page drops a project filter from the URL, which would only pretend to filter", () => {
    expect(validateProjectReportSearch({ projectId: "p9", status: "open" })).toEqual(
      validateReportSearch({ status: "open" }),
    )
    expect(hasFilters(validateProjectReportSearch({ projectId: "none" }))).toBe(false)
  })
})

describe("toReportsQuery", () => {
  test("a project page always queries its own project", () => {
    expect(toReportsQuery({ projectId: "p1" }, { projectId: "none", captureType: "video" })).toMatchObject({
      projectId: "p1",
      captureType: "video",
    })
  })

  test("all reports can be narrowed to reports without a project", () => {
    expect(toReportsQuery({}, { projectId: "none" }).projectId).toBe("none")
    expect(toReportsQuery({}, {})).not.toHaveProperty("projectId")
  })

  test("passes the reporter filter on", () => {
    expect(toReportsQuery({}, { reporterId: "u1" }).reporterId).toBe("u1")
  })

  test("fills defaults and leaves out empty filters; the feed adds the part to fetch", () => {
    expect(toReportsQuery({ projectId: "p1" }, {})).toEqual({ projectId: "p1", sort: "newest" })
    expect(toReportsQuery({ projectId: "p1" }, { status: ["open"], q: "pay" })).toEqual({
      projectId: "p1",
      status: ["open"],
      q: "pay",
      sort: "newest",
    })
  })
})

describe("toggleValue", () => {
  test("adds, removes, and clears", () => {
    expect(toggleValue(undefined, "open")).toEqual(["open"])
    expect(toggleValue(["open", "closed"], "open")).toEqual(["closed"])
    expect(toggleValue(["open"], "open")).toBeUndefined()
  })
})
