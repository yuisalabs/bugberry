import { beforeEach, describe, expect, test } from "bun:test"
import { createSharedRateLimiter, deleteOldRateLimitHits } from "../src/lib/shared-rate-limit"
import { getTestDb, resetDb } from "./helpers"

const db = await getTestDb()

beforeEach(async () => {
  await resetDb(db)
})

describe("createSharedRateLimiter", () => {
  test("allows `limit` calls per key and window, then refuses until the next window", async () => {
    let clock = 60_000
    const limiter = createSharedRateLimiter(db, { bucket: "test", limit: 2, windowMs: 60_000, now: () => clock })
    expect([await limiter.consume("a"), await limiter.consume("a"), await limiter.consume("a")]).toEqual([true, true, false])
    expect(await limiter.consume("b")).toBe(true)
    clock += 60_000
    expect(await limiter.consume("a")).toBe(true)
  })

  test("two limiters on the same bucket share one count, as two MCP containers do", async () => {
    const first = createSharedRateLimiter(db, { bucket: "calls", limit: 3, windowMs: 60_000 })
    const second = createSharedRateLimiter(db, { bucket: "calls", limit: 3, windowMs: 60_000 })
    const other = createSharedRateLimiter(db, { bucket: "screenshots", limit: 3, windowMs: 60_000 })
    const answers = await Promise.all([first, second, first, second].map((limiter) => limiter.consume("person")))
    expect(answers.filter(Boolean)).toHaveLength(3)
    expect(await other.consume("person")).toBe(true)
  })

  test("the cleanup drops windows that have ended and keeps the current one", async () => {
    let clock = 0
    const limiter = createSharedRateLimiter(db, { bucket: "test", limit: 1, windowMs: 60_000, now: () => clock })
    await limiter.consume("old")
    clock = 10 * 60_000
    await limiter.consume("current")
    expect(await deleteOldRateLimitHits(db, new Date(clock))).toBe(1)
    expect(await limiter.consume("current")).toBe(false)
  })
})
