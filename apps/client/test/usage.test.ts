import { describe, expect, test } from "bun:test"
import { usageText } from "../src/lib/usage"

describe("usageText", () => {
  test("nothing when the workspace isn't limited", () => {
    expect(usageText({ limited: false })).toBeNull()
  })

  test("screenshots and recordings kept against their maximums", () => {
    expect(usageText({ limited: true, screenshots: { used: 3, max: 5 }, recordings: { used: 5, max: 5 } })).toBe(
      "3 of 5 screenshots · 5 of 5 recordings",
    )
  })

  test("a workspace over the limit shows its real count", () => {
    expect(usageText({ limited: true, screenshots: { used: 7, max: 5 }, recordings: { used: 0, max: 5 } })).toBe(
      "7 of 5 screenshots · 0 of 5 recordings",
    )
  })

  test("singular when the maximum is 1", () => {
    expect(usageText({ limited: true, screenshots: { used: 0, max: 1 }, recordings: { used: 1, max: 1 } })).toBe(
      "0 of 1 screenshot · 1 of 1 recording",
    )
  })
})
