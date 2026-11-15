import { expect, test } from "bun:test"
import { listedCount } from "../src/report-counts"

test("a list holds the reports of its picked statuses, or all of them when none is picked", () => {
  const counts = { total: 9, byStatus: { open: 6, in_progress: 1, resolved: 2, closed: 0 } }
  expect(listedCount(counts)).toBe(9)
  expect(listedCount(counts, [])).toBe(9)
  expect(listedCount(counts, ["open", "resolved"])).toBe(8)
  expect(listedCount(counts, ["closed"])).toBe(0)
  expect(listedCount(counts, ["open", "open"])).toBe(6)
})
