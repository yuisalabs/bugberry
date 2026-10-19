import { describe, expect, test } from "bun:test"
import { createRateLimiter } from "../src/lib/rate-limit"

describe("createRateLimiter", () => {
  test("allows up to the limit per window and per key", () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now })
    expect([limiter.consume("a"), limiter.consume("a"), limiter.consume("a")]).toEqual([true, true, false])
    expect(limiter.consume("b")).toBe(true)
    now = 1000
    expect(limiter.consume("a")).toBe(true)
  })
})

describe("createRateLimiter memory bound", () => {
  test("evicts the oldest key once maxKeys is reached", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 })
    expect(limiter.consume("a")).toBe(true)
    expect(limiter.consume("a")).toBe(false)
    for (const key of ["b", "c", "d"]) limiter.consume(key)
    // "a" was evicted to stay within 3 keys, so it starts a fresh window.
    expect(limiter.consume("a")).toBe(true)
  })
})
