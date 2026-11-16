import { and, desc, eq, exists, gt, inArray, isNull, sql } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { recordingRequest, report, user, workspace, workspaceMember } from "../../db/schema"

export type RequestRow = typeof recordingRequest.$inferSelect

/** A report takes one of its link's uses while it uploads and once it arrived; a failed upload gives it back. */
const takesAUse = inArray(report.uploadStatus, ["uploading", "ready"])

export async function insertRequest(db: Db, row: typeof recordingRequest.$inferInsert): Promise<RequestRow> {
  const [created] = await executor(db).insert(recordingRequest).values(row).returning()
  if (!created) throw new Error("Failed to create the request link")
  return created
}

export async function findRequest(db: Db, id: string): Promise<RequestRow | null> {
  const [row] = await executor(db).select().from(recordingRequest).where(eq(recordingRequest.id, id)).limit(1)
  return row ?? null
}

export async function findRequestByTokenHash(db: Db, tokenHash: string): Promise<RequestRow | null> {
  const [row] = await executor(db).select().from(recordingRequest).where(eq(recordingRequest.tokenHash, tokenHash)).limit(1)
  return row ?? null
}

/** A link by its token's hash, with what its public page shows and whether its maker can still receive it. */
export async function findRequestForSender(db: Db, tokenHash: string) {
  const [row] = await executor(db)
    .select({
      request: recordingRequest,
      workspaceName: workspace.name,
      makerName: user.name,
      makerActive: isNull(user.deactivatedAt),
      makerIsMember: exists(
        executor(db)
          .select({ one: sql`1` })
          .from(workspaceMember)
          .where(and(eq(workspaceMember.userId, recordingRequest.createdById), eq(workspaceMember.workspaceId, recordingRequest.workspaceId))),
      ),
    })
    .from(recordingRequest)
    .innerJoin(workspace, eq(workspace.id, recordingRequest.workspaceId))
    .innerJoin(user, eq(user.id, recordingRequest.createdById))
    .where(eq(recordingRequest.tokenHash, tokenHash))
    .limit(1)
  return row ?? null
}

/** A workspace's links, newest first, with their maker's name. */
export function listRequests(db: Db, workspaceId: string) {
  return executor(db)
    .select({ request: recordingRequest, createdBy: { id: user.id, name: user.name } })
    .from(recordingRequest)
    .innerJoin(user, eq(user.id, recordingRequest.createdById))
    .where(eq(recordingRequest.workspaceId, workspaceId))
    .orderBy(desc(recordingRequest.createdAt), desc(recordingRequest.id))
}

/** The reports of these links that take a use, oldest first. */
export async function reportsOfRequests(db: Db, requestIds: string[]) {
  if (requestIds.length === 0) return []
  return executor(db)
    .select({ requestId: report.recordingRequestId, id: report.id, number: report.number, uploadStatus: report.uploadStatus })
    .from(report)
    .where(and(inArray(report.recordingRequestId, requestIds), takesAUse))
    .orderBy(report.createdAt)
}

export async function revokeRequest(db: Db, id: string): Promise<void> {
  await executor(db)
    .update(recordingRequest)
    .set({ revokedAt: new Date() })
    .where(and(eq(recordingRequest.id, id), isNull(recordingRequest.revokedAt)))
}

/** Links still taking recordings: not revoked, not expired, not used up. */
export async function countLiveRequests(db: Db, workspaceId: string, now: Date): Promise<number> {
  const [row] = await executor(db)
    .select({ value: sql<number>`count(*)::int` })
    .from(recordingRequest)
    .where(
      and(
        eq(recordingRequest.workspaceId, workspaceId),
        isNull(recordingRequest.revokedAt),
        gt(recordingRequest.expiresAt, now),
        sql`(SELECT count(*) FROM ${report} WHERE ${report.recordingRequestId} = ${recordingRequest.id} AND ${report.uploadStatus} IN ('uploading', 'ready')) < ${recordingRequest.maxUses}`,
      ),
    )
  return row?.value ?? 0
}

export async function countRequestUses(db: Db, requestId: string): Promise<number> {
  const [row] = await executor(db)
    .select({ value: sql<number>`count(*)::int` })
    .from(report)
    .where(and(eq(report.recordingRequestId, requestId), takesAUse))
  return row?.value ?? 0
}
