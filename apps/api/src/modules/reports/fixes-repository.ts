import { and, asc, count, eq, inArray, ne } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { notification, report, reportFix, type ReportFixRow } from "../../db/schema"
import { newId } from "../../lib/ids"

export function listReportFixes(db: Db, reportId: string): Promise<ReportFixRow[]> {
  return executor(db).select().from(reportFix).where(eq(reportFix.reportId, reportId)).orderBy(asc(reportFix.createdAt), asc(reportFix.id))
}

/** Fix links of several reports, for the bell. */
export function listFixesOf(db: Db, reportIds: string[]): Promise<ReportFixRow[]> {
  if (reportIds.length === 0) return Promise.resolve([])
  return executor(db).select().from(reportFix).where(inArray(reportFix.reportId, reportIds)).orderBy(asc(reportFix.createdAt), asc(reportFix.id))
}

/** The new row, or null when that URL is already on the report. */
export async function insertFix(
  db: Db,
  values: { reportId: string; url: string; addedBy: string; viaAgent: string | null },
): Promise<ReportFixRow | null> {
  const [row] = await executor(db)
    .insert(reportFix)
    .values({ id: newId(), ...values })
    .onConflictDoNothing({ target: [reportFix.reportId, reportFix.url] })
    .returning()
  return row ?? null
}

export async function deleteFix(db: Db, reportId: string, fixId: string): Promise<ReportFixRow | null> {
  const [row] = await executor(db)
    .delete(reportFix)
    .where(and(eq(reportFix.id, fixId), eq(reportFix.reportId, reportId)))
    .returning()
  return row ?? null
}

export async function countFixes(db: Db, reportId: string): Promise<number> {
  const [row] = await executor(db).select({ value: count() }).from(reportFix).where(eq(reportFix.reportId, reportId))
  return row?.value ?? 0
}

export async function findReportStatus(db: Db, reportId: string) {
  const [row] = await executor(db).select({ status: report.status }).from(report).where(eq(report.id, reportId)).limit(1)
  return row?.status ?? null
}

/** True only for the call that changed it: a concurrent one waits on the row lock, then matches nothing. */
export async function markResolved(db: Db, reportId: string): Promise<boolean> {
  const rows = await executor(db)
    .update(report)
    .set({ status: "resolved" })
    .where(and(eq(report.id, reportId), ne(report.status, "resolved")))
    .returning({ id: report.id })
  return rows.length > 0
}

export async function insertResolvedNotification(
  db: Db,
  values: { userId: string; reportId: string; actorId: string; viaAgent: string | null },
): Promise<void> {
  await executor(db)
    .insert(notification)
    .values({ id: newId(), kind: "resolved", commentId: null, ...values })
}
