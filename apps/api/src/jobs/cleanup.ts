import { and, eq, inArray, lt } from "drizzle-orm"
import type { AppDeps } from "../deps"
import { agentUpload, report } from "../db/schema"
import { thumbnailKeyFor } from "../storage/keys"

/**
 * Deletes reports that never became visible — still `uploading`, or `failed` — created before
 * `olderThan`, including any uploaded files, and aborts uploads in parts started before then, whose
 * parts take up room in the storage without showing as objects. Agent upload links that expired before then go too.
 */
export async function cleanupStaleUploads({ db, storage }: Pick<AppDeps, "db" | "storage">, olderThan: Date) {
  const stale = await db
    .select({ id: report.id, mediaKey: report.mediaKey, debuggerKey: report.debuggerKey })
    .from(report)
    .where(and(inArray(report.uploadStatus, ["uploading", "failed"]), lt(report.createdAt, olderThan)))

  for (const row of stale) {
    // Always tried, like on delete: a late thumbnail upload leaves an object with no reference.
    const keys = [row.mediaKey, row.debuggerKey, thumbnailKeyFor(row.id)].filter((key): key is string => key !== null)
    await Promise.all(
      keys.map((key) => storage.delete(key).catch((error) => console.warn("cleanup: delete failed", key, error))),
    )
    await db.delete(report).where(eq(report.id, row.id))
  }
  // Agent upload links are worthless once expired; a report's links also go with the report.
  await db.delete(agentUpload).where(lt(agentUpload.expiresAt, olderThan))
  // Also catches uploads whose report is gone or was never saved. One that finished is no longer listed.
  await storage.multipart
    ?.abortStale(olderThan)
    .catch((error) => console.warn("cleanup: aborting stale uploads in parts failed", error))
  return stale.length
}

interface Timers {
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(timer: unknown): void
}

const realTimers: Timers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
}

/** Runs the cleanup at startup (so a restart never postpones it) and then every `everyMs`. Returns a stop function. */
export function startCleanupSchedule(run: () => void, everyMs: number, timers: Timers = realTimers): () => void {
  run()
  const timer = timers.setInterval(run, everyMs)
  return () => timers.clearInterval(timer)
}
