import { describe, expect, test } from "bun:test"
import { queries } from "../src/lib/queries"
import { REPORT_LIST_REFRESH_MS } from "../src/features/reports/queries"

describe("report list query", () => {
  test("refreshes well within the default signed-link lifetime, so a page left open keeps working previews", () => {
    const options = queries.reportFeed("w1", { sort: "newest" })
    expect(options.refetchInterval).toBe(REPORT_LIST_REFRESH_MS)
    expect(REPORT_LIST_REFRESH_MS).toBeLessThanOrEqual(10 * 60_000)
  })
})
