import { describe, expect, test } from "bun:test"
import { slugify } from "../src/lib/slug"

describe("slugify", () => {
  test("makes a URL-safe slug the server accepts", () => {
    const serverPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    for (const [name, slug] of [
      ["Web App Kantor", "web-app-kantor"],
      ["  Café — Ünïcode!! ", "cafe-unicode"],
      [`${"x".repeat(39)} y`, "x".repeat(39)],
    ] as const) {
      expect(slugify(name)).toBe(slug)
      expect(serverPattern.test(slugify(name))).toBe(true)
    }
    expect(slugify("!!!")).toBe("")
  })
})
