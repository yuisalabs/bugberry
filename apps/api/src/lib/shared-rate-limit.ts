import type { Db } from "../db/client"
import { countHit, deleteHitsBefore } from "../modules/rate-limits/repository"
import type { AsyncRateLimiter } from "./rate-limit"

/**
 * Fixed-window limiter counted in Postgres: every process that shares the database shares the count, so a person
 * gets the same allowance however many MCP containers answer them. One upsert per call.
 */
export function createSharedRateLimiter(
  db: Db,
  options: { bucket: string; limit: number; windowMs: number; now?: () => number },
): AsyncRateLimiter {
  const now = options.now ?? Date.now
  return {
    async consume(key) {
      const windowStart = Math.floor(now() / options.windowMs) * options.windowMs
      return (await countHit(db, options.bucket, key, windowStart)) <= options.limit
    },
  }
}

/** Drops counts of windows that started before `before`; the hourly cleanup runs it. */
export function deleteOldRateLimitHits(db: Db, before: Date): Promise<number> {
  return deleteHitsBefore(db, before.getTime())
}
