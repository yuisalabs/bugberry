import { describe, expect, test } from "bun:test"
import { queries } from "../src/lib/queries"

describe("comment and activity queries", () => {
  test("refresh when the window comes back into focus, so teammates' replies show up", () => {
    expect(queries.comments("r1").refetchOnWindowFocus).toBe(true)
    expect(queries.activity("r1").refetchOnWindowFocus).toBe(true)
  })
})
