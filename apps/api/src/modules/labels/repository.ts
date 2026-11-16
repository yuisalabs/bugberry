import type { LabelColor } from "@bugberry/shared"
import { and, asc, count, eq, inArray, notInArray, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { label, report, reportLabel } from "../../db/schema"

export interface LabelView {
  id: string
  name: string
  color: LabelColor
}

const view = { id: label.id, name: label.name, color: label.color }
const byName = [asc(sql`lower(${label.name})`), asc(label.id)]

/** A workspace's labels by name, each with how many reports carry it. */
export async function listLabels(db: Db, workspaceId: string): Promise<Array<LabelView & { reportCount: number }>> {
  return executor(db)
    .select({ ...view, reportCount: sql<number>`(SELECT count(*)::int FROM ${reportLabel} WHERE ${reportLabel.labelId} = ${label.id})` })
    .from(label)
    .where(eq(label.workspaceId, workspaceId))
    .orderBy(...byName)
}

export async function findLabel(db: Db, id: string): Promise<(LabelView & { workspaceId: string }) | null> {
  const [row] = await executor(db)
    .select({ ...view, workspaceId: label.workspaceId })
    .from(label)
    .where(eq(label.id, id))
    .limit(1)
  return row ?? null
}

export async function insertLabel(
  db: Db,
  row: { id: string; workspaceId: string; name: string; color: LabelColor; createdById: string },
): Promise<LabelView> {
  const [created] = await executor(db).insert(label).values(row).returning(view)
  return created!
}

export async function updateLabel(db: Db, id: string, changes: { name?: string; color?: LabelColor }): Promise<LabelView | null> {
  const [updated] = await executor(db)
    .update(label)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(label.id, id))
    .returning(view)
  return updated ?? null
}

export async function deleteLabel(db: Db, id: string): Promise<void> {
  await executor(db).delete(label).where(eq(label.id, id))
}

export async function countLabels(db: Db, workspaceId: string): Promise<number> {
  const [row] = await executor(db).select({ n: count() }).from(label).where(eq(label.workspaceId, workspaceId))
  return row?.n ?? 0
}

/** The labels among `ids` that belong to the workspace; ids of other workspaces are left out. */
export async function findLabelsByIds(db: Db, workspaceId: string, ids: readonly string[]): Promise<LabelView[]> {
  if (ids.length === 0) return []
  return executor(db)
    .select(view)
    .from(label)
    .where(and(eq(label.workspaceId, workspaceId), inArray(label.id, [...ids])))
    .orderBy(...byName)
}

/** The workspace's labels whose names match `names` without regard to case. */
export async function findLabelsByNames(db: Db, workspaceId: string, names: readonly string[]): Promise<LabelView[]> {
  if (names.length === 0) return []
  const lowered = names.map((name) => name.trim().toLowerCase())
  return executor(db)
    .select(view)
    .from(label)
    .where(and(eq(label.workspaceId, workspaceId), inArray(sql`lower(${label.name})`, lowered)))
    .orderBy(...byName)
}

/** Each report's labels by name; a report without any is left out of the map. */
export async function labelsOfReports(db: Db, reportIds: readonly string[]): Promise<Map<string, LabelView[]>> {
  const found = new Map<string, LabelView[]>()
  if (reportIds.length === 0) return found
  const rows = await executor(db)
    .select({ reportId: reportLabel.reportId, ...view })
    .from(reportLabel)
    .innerJoin(label, eq(label.id, reportLabel.labelId))
    .where(inArray(reportLabel.reportId, [...reportIds]))
    .orderBy(...byName)
  for (const { reportId, ...labelView } of rows) found.set(reportId, [...(found.get(reportId) ?? []), labelView])
  return found
}

/** Until the transaction ends, other label changes on this report wait here. */
export async function lockReportLabels(db: Db, reportId: string): Promise<void> {
  await executor(db).select({ id: report.id }).from(report).where(eq(report.id, reportId)).for("update")
}

/** Makes the report carry exactly `labelIds`. */
export async function replaceReportLabels(db: Db, reportId: string, labelIds: readonly string[]): Promise<void> {
  const x = executor(db)
  await x
    .delete(reportLabel)
    .where(and(eq(reportLabel.reportId, reportId), labelIds.length ? notInArray(reportLabel.labelId, [...labelIds]) : undefined))
  if (labelIds.length) {
    await x
      .insert(reportLabel)
      .values(labelIds.map((labelId) => ({ reportId, labelId })))
      .onConflictDoNothing()
  }
}
