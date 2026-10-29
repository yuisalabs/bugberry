import { MAX_THUMBNAIL_BYTES, THUMBNAIL_CONTENT_TYPE, THUMBNAIL_MAX_WIDTH, THUMBNAIL_QUALITY } from "@bugberry/shared"
import { and, asc, eq, isNull } from "drizzle-orm"
import type { Db } from "../db/client"
import { report } from "../db/schema"
import { thumbnailKeyFor } from "../storage/keys"
import type { StorageDriver } from "../storage/types"

export interface BackfillSummary {
  checked: number
  created: number
  missing: number
  tooLarge: number
  failed: number
}

/** The same preview the extension makes: a JPEG at most THUMBNAIL_MAX_WIDTH wide, never scaled up. */
export function screenshotThumbnail(image: Uint8Array): Promise<Uint8Array> {
  return new Bun.Image(image)
    .resize(THUMBNAIL_MAX_WIDTH, undefined, { withoutEnlargement: true })
    .jpeg({ quality: Math.round(THUMBNAIL_QUALITY * 100) })
    .bytes()
}

/**
 * Makes previews for screenshots sent before the extension uploaded one, so cards stop loading the full image.
 * A dry run lists them; one failure never stops the rest, and a rerun finds only what is left. Videos are skipped.
 */
export async function backfillThumbnails(
  deps: { db: Db; storage: StorageDriver },
  opts: { apply: boolean; log: (line: string) => void },
): Promise<BackfillSummary> {
  const summary: BackfillSummary = { checked: 0, created: 0, missing: 0, tooLarge: 0, failed: 0 }
  const screenshots = await deps.db
    .select({ id: report.id, mediaKey: report.mediaKey })
    .from(report)
    .where(and(eq(report.captureType, "screenshot"), eq(report.uploadStatus, "ready"), isNull(report.thumbnailKey)))
    .orderBy(asc(report.createdAt))

  for (const screenshot of screenshots) {
    summary.checked += 1
    if (!opts.apply) {
      opts.log(`would add ${screenshot.mediaKey}`)
      continue
    }
    try {
      const file = await deps.storage.read(screenshot.mediaKey)
      if (!file) {
        summary.missing += 1
        opts.log(`missing   ${screenshot.mediaKey}`)
        continue
      }
      const thumbnail = await screenshotThumbnail(new Uint8Array(await file.arrayBuffer()))
      if (thumbnail.byteLength > MAX_THUMBNAIL_BYTES) {
        summary.tooLarge += 1
        opts.log(`too large ${screenshot.mediaKey}: ${thumbnail.byteLength} bytes`)
        continue
      }
      const key = thumbnailKeyFor(screenshot.id)
      await deps.storage.replace(key, new Uint8Array(thumbnail), THUMBNAIL_CONTENT_TYPE)
      await deps.db
        .update(report)
        .set({ thumbnailKey: key, thumbnailSize: thumbnail.byteLength })
        .where(and(eq(report.id, screenshot.id), isNull(report.thumbnailKey)))
      summary.created += 1
      opts.log(`added     ${key}`)
    } catch (error) {
      summary.failed += 1
      opts.log(`failed    ${screenshot.mediaKey}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return summary
}
