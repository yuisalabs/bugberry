import { lt, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { rateLimitHit } from "../../db/schema"

/** Adds one call to the window's count for `bucket` and `key`, and returns the new count. */
export async function countHit(db: Db, bucket: string, key: string, windowStart: number): Promise<number> {
  const [row] = await executor(db)
    .insert(rateLimitHit)
    .values({ bucket, key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitHit.bucket, rateLimitHit.key, rateLimitHit.windowStart],
      set: { count: sql`${rateLimitHit.count} + 1` },
    })
    .returning({ count: rateLimitHit.count })
  return row?.count ?? 1
}

/** Drops the counts of windows that started before `beforeMs`; returns how many. */
export async function deleteHitsBefore(db: Db, beforeMs: number): Promise<number> {
  const removed = await executor(db).delete(rateLimitHit).where(lt(rateLimitHit.windowStart, beforeMs)).returning({ key: rateLimitHit.key })
  return removed.length
}
