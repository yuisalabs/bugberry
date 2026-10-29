import { and, desc, eq, gt, inArray, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { type ActivityKind, report, reportActivity, user } from "../../db/schema"
import { newId } from "../../lib/ids"
import type { ActivityActor } from "./service"

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
  await executor(db).execute(sql.raw(BACKFILL_TRACKER_ACTIVITY))
}

export async function recordActivity(
  db: Db,
  input: { reportId: string; kind: Exclude<ActivityKind, "agent_read">; detail: Record<string, unknown> } & ActivityActor,
): Promise<void> {
  await executor(db).insert(reportActivity).values({
    id: newId(),
    reportId: input.reportId,
    actorId: input.actorId,
    viaAgent: input.viaAgent,
    kind: input.kind,
    detail: input.detail,
  })
}

/** Until the transaction ends, other reads by the same person and agent on this report wait here. */
export async function lockAgentReads(db: Db, reportId: string, actorId: string, viaAgent: string): Promise<void> {
  await executor(db).execute(sql`select pg_advisory_xact_lock(hashtext(${`agent-read:${reportId}:${actorId}:${viaAgent}`}))`)
}

/** The person's newest agent-read line with this agent on the report, begun after `since`. */
export async function findOpenAgentRead(db: Db, input: { reportId: string; actorId: string; viaAgent: string; since: Date }) {
  const [open] = await executor(db)
    .select({ id: reportActivity.id, detail: reportActivity.detail })
    .from(reportActivity)
    .where(
      and(
        eq(reportActivity.reportId, input.reportId),
        eq(reportActivity.kind, "agent_read"),
        eq(reportActivity.actorId, input.actorId),
        eq(reportActivity.viaAgent, input.viaAgent),
        gt(reportActivity.createdAt, input.since),
      ),
    )
    .orderBy(desc(reportActivity.createdAt))
    .limit(1)
  return open ?? null
}

export async function insertAgentRead(
  db: Db,
  input: { reportId: string; actorId: string; viaAgent: string; parts: string[]; at: Date },
): Promise<void> {
  await executor(db).insert(reportActivity).values({
    id: newId(),
    reportId: input.reportId,
    actorId: input.actorId,
    viaAgent: input.viaAgent,
    kind: "agent_read",
    detail: { parts: input.parts },
    createdAt: input.at,
    updatedAt: input.at,
  })
}

export async function updateAgentReadParts(db: Db, id: string, parts: string[], at: Date): Promise<void> {
  await executor(db).update(reportActivity).set({ detail: { parts }, updatedAt: at }).where(eq(reportActivity.id, id))
}

/** A finished upload's creation line: when, from which browser, by whom. */
export async function findReportCreation(db: Db, reportId: string) {
  const [target] = await executor(db)
    .select({
      createdAt: report.createdAt,
      device: report.device,
      viaAgent: report.viaAgent,
      reporter: { id: user.id, name: user.name, image: user.image },
    })
    .from(report)
    .innerJoin(user, eq(user.id, report.reporterId))
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
    .limit(1)
  return target ?? null
}

export function listReportActivity(db: Db, reportId: string) {
  return executor(db)
    .select()
    .from(reportActivity)
    .where(eq(reportActivity.reportId, reportId))
    .orderBy(desc(reportActivity.createdAt), desc(reportActivity.id))
}

export function listPeople(db: Db, ids: string[]) {
  return executor(db).select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, ids))
}
