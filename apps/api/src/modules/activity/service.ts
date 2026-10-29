import type { AppDeps } from "../../deps"
import type { CurrentUser } from "../../plugins/auth"
import { type Db, withTransaction } from "../../db/client"
import type { ActivityKind } from "../../db/schema"
import { notFound } from "../../lib/errors"
import { requireReportMember } from "../workspaces/access"
import type { PersonSummary } from "../reports/detail"
import {
  findOpenAgentRead,
  findReportCreation,
  insertAgentRead,
  listPeople,
  listReportActivity,
  lockAgentReads,
  updateAgentReadParts,
} from "./repository"

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
  await withTransaction(db, async () => {
    await lockAgentReads(db, input.reportId, input.actorId, input.viaAgent)
    const open = await findOpenAgentRead(db, { ...input, since: new Date(now.getTime() - READ_WINDOW_MS) })
    if (!open) {
      await insertAgentRead(db, { ...input, parts: [input.part], at: now })
      return
    }
    const parts = (open.detail as { parts?: ReadPart[] }).parts ?? []
    await updateAgentReadParts(db, open.id, parts.includes(input.part) ? parts : [...parts, input.part], now)
  })
}

/** The report's activity for the feed, newest first; the report's creation is always the last line. */
export async function listActivity({ db }: Pick<AppDeps, "db">, current: CurrentUser, reportId: string) {
  await requireReportMember(db, current.id, reportId)
  const target = await findReportCreation(db, reportId)
  if (!target) throw notFound("report_not_found", "Report not found")
  const rows = await listReportActivity(db, reportId)
  const assigneeIds = rows.flatMap((row) => {
    if (row.kind !== "assignee") return []
    const detail = row.detail as { from: string | null; to: string | null }
    return [detail.from, detail.to].filter((id): id is string => id !== null)
  })
  const ids = [...new Set([...rows.flatMap((row) => (row.actorId ? [row.actorId] : [])), ...assigneeIds])]
  const people = new Map<string, PersonSummary>(
    ids.length === 0
      ? []
      : (await listPeople(db, ids)).map((person) => [person.id, person]),
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
