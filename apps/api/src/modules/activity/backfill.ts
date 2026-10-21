import { sql } from "drizzle-orm"
import type { Db } from "../../db/client"

/**
 * Tracker sends made before the activity log existed, as activity lines with no actor (who pressed Send was
 * never stored). The same statement ends migration 0020; failed or unfinished sends are left out.
 */
export const BACKFILL_TRACKER_ACTIVITY = `INSERT INTO "report_activity" ("id", "report_id", "actor_id", "via_agent", "kind", "detail", "created_at", "updated_at")
SELECT gen_random_uuid()::text, l."report_id", NULL, NULL, 'tracker',
  jsonb_build_object('provider', i."provider", 'externalId', l."external_id", 'externalUrl', l."external_url"),
  l."created_at", l."created_at"
FROM "report_external_link" l
JOIN "integration" i ON i."id" = l."integration_id"
WHERE l."external_id" IS NOT NULL;`

export async function backfillTrackerActivity(db: Db): Promise<void> {
  await db.execute(sql.raw(BACKFILL_TRACKER_ACTIVITY))
}
