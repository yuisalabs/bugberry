import { and, asc, eq } from "drizzle-orm"
import type { Db } from "../db/client"
import { report } from "../db/schema"
import type { StorageDriver } from "../storage/types"
import { applyWebmPatches, planWebmRepair, WEBM_HEAD_BYTES } from "../storage/webm-repair"

export interface RepairSummary {
  checked: number
  needsRepair: number
  repaired: number
  alreadyOk: number
  unrecognized: number
  missing: number
  failed: number
}

/**
 * Finds video recordings that Safari cannot play because fix-webm-duration rewrote their sizes (see
 * planWebmRepair) and, with `apply`, writes each one back repaired. A dry run only reads the start of each
 * file. One recording failing never stops the others.
 */
export async function repairWebmRecordings(
  deps: { db: Db; storage: StorageDriver },
  opts: { apply: boolean; log: (line: string) => void },
): Promise<RepairSummary> {
  const summary: RepairSummary = { checked: 0, needsRepair: 0, repaired: 0, alreadyOk: 0, unrecognized: 0, missing: 0, failed: 0 }
  const videos = await deps.db
    .select({ id: report.id, mediaKey: report.mediaKey, mediaType: report.mediaType })
    .from(report)
    .where(and(eq(report.captureType, "video"), eq(report.uploadStatus, "ready")))
    .orderBy(asc(report.createdAt))

  for (const video of videos) {
    summary.checked += 1
    try {
      const file = await deps.storage.read(video.mediaKey)
      if (!file) {
        summary.missing += 1
        opts.log(`missing   ${video.mediaKey}`)
        continue
      }
      const head = new Uint8Array(await file.slice(0, WEBM_HEAD_BYTES).arrayBuffer())
      const plan = planWebmRepair(head, file.size)
      if (plan.status === "ok") {
        summary.alreadyOk += 1
        continue
      }
      if (plan.status === "unrecognized") {
        summary.unrecognized += 1
        opts.log(`skipped   ${video.mediaKey}: ${plan.reason}`)
        continue
      }
      summary.needsRepair += 1
      if (!opts.apply) {
        opts.log(`would fix ${video.mediaKey}`)
        continue
      }
      const repaired = applyWebmPatches(new Uint8Array(await file.arrayBuffer()), plan.patches)
      await deps.storage.replace(video.mediaKey, repaired, video.mediaType)
      summary.repaired += 1
      opts.log(`fixed     ${video.mediaKey}`)
    } catch (error) {
      summary.failed += 1
      opts.log(`failed    ${video.mediaKey}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return summary
}
