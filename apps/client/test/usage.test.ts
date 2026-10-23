import { describe, expect, test } from "bun:test"
import { invitesAllowed, usageText } from "../src/lib/usage"

const MB = 1024 * 1024
const SIZES = { storage: { used: 120 * MB, max: 250 * MB }, maxFileBytes: 50 * MB }

describe("usageText", () => {
  test("nothing when the workspace isn't limited", () => {
    expect(usageText({ limited: false })).toBeNull()
  })

  test("screenshots and recordings kept against their maximums", () => {
    expect(usageText({ limited: true, screenshots: { used: 3, max: 5 }, recordings: { used: 5, max: 5 }, ...SIZES })).toBe(
      "3 of 5 screenshots · 5 of 5 recordings · 120 MB of 250 MB",
    )
  })

  test("a workspace over the limit shows its real count", () => {
    expect(usageText({ limited: true, screenshots: { used: 7, max: 5 }, recordings: { used: 0, max: 5 }, ...SIZES })).toBe(
      "7 of 5 screenshots · 0 of 5 recordings · 120 MB of 250 MB",
    )
  })

  test("singular when the maximum is 1", () => {
    expect(usageText({ limited: true, screenshots: { used: 0, max: 1 }, recordings: { used: 1, max: 1 }, ...SIZES })).toBe(
      "0 of 1 screenshot · 1 of 1 recording · 120 MB of 250 MB",
    )
  })
})

describe("invitesAllowed", () => {
  test("only once the workspace is known not to be limited", () => {
    expect(invitesAllowed(undefined)).toBe(false)
    expect(invitesAllowed({ limited: false })).toBe(true)
    expect(invitesAllowed({ limited: true, screenshots: { used: 0, max: 5 }, recordings: { used: 0, max: 5 }, ...SIZES })).toBe(false)
  })
})
