import { type OnboardingItemId, TRACKER_PROVIDERS } from "@bugberry/shared"
import { and, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { type Db, executor } from "../../db/client"
import {
  apiToken,
  comment,
  connection,
  integration,
  oauthConsent,
  type OnboardingState,
  project,
  report,
  reportActivity,
  user,
  workspaceInvitation,
} from "../../db/schema"

async function exists(db: Db, query: { from: PgTable; where: SQL | undefined }): Promise<boolean> {
  const rows = await executor(db).select({ one: sql`1` }).from(query.from).where(query.where).limit(1)
  return rows.length > 0
}

/** The workspace's projects that use a tracker (not a notifier): only then can a report be sent to one. */
export async function listTrackerProjects(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await executor(db)
    .select({ id: project.id })
    .from(project)
    .innerJoin(integration, eq(integration.projectId, project.id))
    .where(and(eq(project.workspaceId, workspaceId), inArray(integration.provider, [...TRACKER_PROVIDERS])))
  return rows.map((row) => row.id)
}

/** Whether a step or mission is done according to the other tables; null for steps only the dashboard reports. */
export function doneElsewhere(db: Db, id: OnboardingItemId, userId: string, workspaceId: string): Promise<boolean> | null {
  const captured = (type: "screenshot" | "video") =>
    exists(db, {
      from: report,
      where: and(eq(report.reporterId, userId), eq(report.captureType, type), eq(report.uploadStatus, "ready")),
    })
  switch (id) {
    // Every report came from the extension, whatever became of its upload.
    case "extension":
      return exists(db, { from: report, where: eq(report.reporterId, userId) })
    case "screenshot":
    case "video":
      return captured(id)
    case "invite":
      return exists(db, { from: workspaceInvitation, where: eq(workspaceInvitation.invitedById, userId) })
    case "project":
      return exists(db, { from: project, where: eq(project.workspaceId, workspaceId) })
    case "comment":
      return exists(db, { from: comment, where: eq(comment.authorId, userId) })
    case "tracker":
      return exists(db, {
        from: connection,
        where: and(eq(connection.workspaceId, workspaceId), inArray(connection.provider, [...TRACKER_PROVIDERS])),
      })
    case "send":
      return exists(db, { from: reportActivity, where: and(eq(reportActivity.actorId, userId), eq(reportActivity.kind, "tracker")) })
    case "agent":
      return Promise.all([
        exists(db, { from: apiToken, where: and(eq(apiToken.userId, userId), eq(apiToken.kind, "mcp"), isNull(apiToken.revokedAt)) }),
        exists(db, { from: oauthConsent, where: eq(oauthConsent.userId, userId) }),
      ]).then(([token, consent]) => token || consent)
    default:
      return null
  }
}

/** The newest ready report in the workspace; `reporterId` and `projectIds` narrow it. */
export async function newestReadyReport(
  db: Db,
  input: { workspaceId: string; reporterId?: string; projectIds?: string[] },
): Promise<string | null> {
  const [row] = await executor(db)
    .select({ id: report.id })
    .from(report)
    .where(
      and(
        eq(report.workspaceId, input.workspaceId),
        eq(report.uploadStatus, "ready"),
        input.reporterId ? eq(report.reporterId, input.reporterId) : undefined,
        input.projectIds ? inArray(report.projectId, input.projectIds) : undefined,
      ),
    )
    .orderBy(desc(report.createdAt))
    .limit(1)
  return row?.id ?? null
}

export async function findOnboardingState(db: Db, userId: string): Promise<OnboardingState | null> {
  const [row] = await executor(db).select({ onboarding: user.onboarding }).from(user).where(eq(user.id, userId))
  return row?.onboarding ?? null
}

/** The checklist with the person's row locked until the transaction ends. */
export async function lockOnboardingState(db: Db, userId: string): Promise<OnboardingState | null> {
  const [row] = await executor(db).select({ onboarding: user.onboarding }).from(user).where(eq(user.id, userId)).for("update")
  return row?.onboarding ?? null
}

export async function setOnboardingState(db: Db, userId: string, state: OnboardingState): Promise<void> {
  await executor(db).update(user).set({ onboarding: state }).where(eq(user.id, userId))
}
