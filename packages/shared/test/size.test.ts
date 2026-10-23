import { expect, test } from "bun:test"
import { sizeLabel } from "../src/size"

test("sizes read as MB, GB past 1024 MB, with a decimal only below 10", () => {
  const MB = 1024 * 1024
  expect(sizeLabel(250 * MB)).toBe("250 MB")
  expect(sizeLabel(12.4 * MB)).toBe("12 MB")
  expect(sizeLabel(2.35 * MB)).toBe("2.4 MB")
  expect(sizeLabel(0)).toBe("0 MB")
  expect(sizeLabel(1536 * MB)).toBe("1.5 GB")
})
