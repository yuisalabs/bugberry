import { describe, expect, test } from "bun:test"
import { newId, newShareSlug } from "../src/lib/ids"

describe("ids", () => {
  test("newId returns distinct UUIDs", () => {
    const a = newId()
    const b = newId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
  })

  test("newShareSlug is 12 alphanumeric characters and not repeated", () => {
    const slugs = new Set(Array.from({ length: 1000 }, () => newShareSlug()))
    expect(slugs.size).toBe(1000)
    for (const slug of slugs) expect(slug).toMatch(/^[A-Za-z0-9]{12}$/)
  })
})
