import { describe, expect, test } from "bun:test"
import { conversionTrim } from "../lib/trim-video"

describe("conversionTrim", () => {
  test("hands mediabunny the range in seconds", () => {
    expect(conversionTrim({ startMs: 6_000, endMs: 35_500 })).toEqual({ start: 6, end: 35.5 })
  })
})
