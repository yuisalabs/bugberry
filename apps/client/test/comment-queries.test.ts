import { describe, expect, test } from "bun:test"
import { reportQueries } from "../src/features/reports/queries"

describe("comment and activity queries", () => {
  test("refresh when the window comes back into focus, so teammates' replies show up", () => {
    expect(reportQueries.comments("r1").refetchOnWindowFocus).toBe(true)
    expect(reportQueries.activity("r1").refetchOnWindowFocus).toBe(true)
  })
})
