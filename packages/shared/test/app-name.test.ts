import { describe, expect, test } from "bun:test"
import { APP_NAME_MAX, cleanAppName } from "../src/app-name"

describe("cleanAppName", () => {
  test("keeps a normal name", () => {
    expect(cleanAppName("Claude Code")).toBe("Claude Code")
  })

  test("removes control characters and folds whitespace, including line breaks", () => {
    expect(cleanAppName("  Claude\r\nBcc: x@evil\u0000 \t Code  ")).toBe("Claude Bcc: x@evil Code")
    expect(cleanAppName("Cla‮ude")).toBe("Claude")
  })

  test(`cuts long names at ${APP_NAME_MAX} characters`, () => {
    const cleaned = cleanAppName("A".repeat(200))
    expect(cleaned).toBe(`${"A".repeat(APP_NAME_MAX - 1)}…`)
    expect(cleaned.length).toBe(APP_NAME_MAX)
  })

  test("falls back when nothing is left", () => {
    expect(cleanAppName(null)).toBe("AI app")
    expect(cleanAppName("\u0000​  ")).toBe("AI app")
  })
})
