import { and, desc, eq, gt, inArray, sql } from "drizzle-orm"
import type { AppDeps } from "../../app"
import type { CurrentUser } from "../../auth/plugin"
import type { Db } from "../../db/client"
import { type ActivityKind, report, reportActivity, user } from "../../db/schema"
import { notFound } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { requireReportMember } from "../../workspaces/access"
import type { PersonSummary } from "../reports/detail"

/** Who did it: a person, with the AI agent they used when it came through MCP; no person for automatic sends. */
export interface ActivityActor {
  actorId: string | null
  viaAgent: string | null
}

/** What an AI agent read of a report, from the MCP tool it called. */
export type ReadPart =
  | "report"
  | "comments"
  | "screenshot"
  | "recording"
  | "timeline"
  | "console"
  | "actions"
  | "network"
  | "performance"
  | "frustration"
  | "code"

/** Reads by the same person and agent within this long share one line. */
const READ_WINDOW_MS = 60 * 60_000

export async function recordActivity(
  db: Db,
  input: { reportId: string; kind: Exclude<ActivityKind, "agent_read">; detail: Record<string, unknown> } & ActivityActor,
): Promise<void> {
  await db.insert(reportActivity).values({
    id: newId(),
    reportId: input.reportId,
    actorId: input.actorId,
    viaAgent: input.viaAgent,
    kind: input.kind,
    detail: input.detail,
  })
}

/**
 * Notes that an agent read part of a report. Within an hour of when the person's line with that agent began, the
 * part joins that line (and moves it to now), so a session of reading shows once.
 */
export async function recordAgentRead(
  db: Db,
  input: { reportId: string; actorId: string; viaAgent: string; part: ReadPart; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date()
  // Agents call several tools at once; the lock makes those calls take turns, so they share one line.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent-read:${input.reportId}:${input.actorId}:${input.viaAgent}`}))`)
    const [open] = await tx
      .select({ id: reportActivity.id, detail: reportActivity.detail })
      .from(reportActivity)
      .where(
        and(
          eq(reportActivity.reportId, input.reportId),
          eq(reportActivity.kind, "agent_read"),
          eq(reportActivity.actorId, input.actorId),
          eq(reportActivity.viaAgent, input.viaAgent),
          gt(reportActivity.createdAt, new Date(now.getTime() - READ_WINDOW_MS)),
        ),
      )
      .orderBy(desc(reportActivity.createdAt))
      .limit(1)
    if (!open) {
      await tx.insert(reportActivity).values({
        id: newId(),
        reportId: input.reportId,
        actorId: input.actorId,
        viaAgent: input.viaAgent,
        kind: "agent_read",
        detail: { parts: [input.part] },
        createdAt: now,
        updatedAt: now,
      })
      return
    }
    const parts = (open.detail as { parts?: ReadPart[] }).parts ?? []
    await tx
      .update(reportActivity)
      .set({ detail: { parts: parts.includes(input.part) ? parts : [...parts, input.part] }, updatedAt: now })
      .where(eq(reportActivity.id, open.id))
  })
}

/** The report's activity for the feed, newest first; the report's creation is always the last line. */
export async function listActivity({ db }: Pick<AppDeps, "db">, current: CurrentUser, reportId: string) {
  await requireReportMember(db, current.id, reportId)
  const [target] = await db
    .select({ createdAt: report.createdAt, device: report.device, viaAgent: report.viaAgent, reporter: { id: user.id, name: user.name, image: user.image } })
    .from(report)
    .innerJoin(user, eq(user.id, report.reporterId))
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
    .limit(1)
  if (!target) throw notFound("report_not_found", "Report not found")
  const rows = await db
    .select()
    .from(reportActivity)
    .where(eq(reportActivity.reportId, reportId))
    .orderBy(desc(reportActivity.createdAt), desc(reportActivity.id))
  const assigneeIds = rows.flatMap((row) => {
    if (row.kind !== "assignee") return []
    const detail = row.detail as { from: string | null; to: string | null }
    return [detail.from, detail.to].filter((id): id is string => id !== null)
  })
  const ids = [...new Set([...rows.flatMap((row) => (row.actorId ? [row.actorId] : [])), ...assigneeIds])]
  const people = new Map<string, PersonSummary>(
    ids.length === 0
      ? []
      : (await db.select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, ids))).map(
          (person) => [person.id, person],
        ),
  )
  const personOf = (id: string | null) => (id ? (people.get(id) ?? null) : null)
  const items = rows.map((row) => ({
    id: row.id,
    kind: row.kind as ActivityKind | "created",
    at: row.kind === "agent_read" ? row.updatedAt : row.createdAt,
    actor: personOf(row.actorId),
    viaAgent: row.viaAgent,
    detail:
      row.kind === "assignee"
        ? (() => {
            const detail = row.detail as { from: string | null; to: string | null }
            return { from: personOf(detail.from), to: personOf(detail.to) }
          })()
        : row.detail,
  }))
  items.sort((left, right) => right.at.getTime() - left.at.getTime())
  return [
    ...items,
    {
      id: `created-${reportId}`,
      kind: "created" as const,
      at: target.createdAt,
      actor: target.reporter as PersonSummary | null,
      viaAgent: target.viaAgent,
      detail: { browser: target.device.browser } as Record<string, unknown>,
    },
  ]
}

export type ActivityView = Awaited<ReturnType<typeof listActivity>>[number]
