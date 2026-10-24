import { expect, test } from "bun:test"
import { clockLabel, tooLong } from "../src/duration"

test("lengths read as minutes and seconds, whole seconds down", () => {
  expect(clockLabel(190_000)).toBe("3:10")
  expect(clockLabel(120_000)).toBe("2:00")
  expect(clockLabel(5_999)).toBe("0:05")
  expect(clockLabel(3_600_000)).toBe("60:00")
})

test("a recording is too long only past the limit and its 5 s of slack", () => {
  expect(tooLong(125_000, 120_000)).toBe(false)
  expect(tooLong(125_001, 120_000)).toBe(true)
})
