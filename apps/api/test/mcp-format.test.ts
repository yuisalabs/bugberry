import { describe, expect, test } from "bun:test"
import { clip, offsetLabel, paginate } from "../src/mcp/format"

describe("clip", () => {
  test("keeps short text and marks what it cut", () => {
    expect(clip("short", 10)).toBe("short")
    expect(clip("x".repeat(2500))).toBe(`${"x".repeat(2000)}…[truncated 500 chars]`)
  })
})

describe("offsetLabel", () => {
  test.each([
    [12_345, "+00:12.3"],
    [-800, "-00:00.8"],
    [3_725_000, "+62:05.0"],
    [0, "+00:00.0"],
  ])("%d → %s", (ms, label) => {
    expect(offsetLabel(ms)).toBe(label)
  })
})

describe("paginate", () => {
  const items = Array.from({ length: 120 }, (_, n) => n)

  test("pages through with a cursor", () => {
    const first = paginate(items)
    expect(first.items).toHaveLength(50)
    expect(first.remaining).toBe(70)
    const second = paginate(items, 50, first.nextCursor ?? undefined)
    expect(second.items[0]).toBe(50)
    const last = paginate(items, 50, second.nextCursor ?? undefined)
    expect(last.items).toHaveLength(20)
    expect(last.nextCursor).toBeNull()
    expect(last.remaining).toBe(0)
  })

  test("caps the limit at 200", () => {
    expect(paginate(Array.from({ length: 500 }, (_, n) => n), 1000).items).toHaveLength(200)
  })

  test("refuses a bad cursor", () => {
    expect(() => paginate(items, 10, "not-a-cursor!")).toThrow("Invalid cursor")
  })
})
