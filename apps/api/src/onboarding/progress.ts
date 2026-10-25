import { ONBOARDING_STEPS, TRACKER_PROVIDERS, type OnboardingItemId, type OnboardingMissionId } from "@bugberry/shared"
import { and, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import type { Db } from "../db/client"
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
} from "../db/schema"
import { memberRole } from "../workspaces/access"

export type OnboardingPhase = "required" | "celebrate" | "bonus"

export interface OnboardingProgress {
  phase: OnboardingPhase
  /** The five steps until they are celebrated, then the missions this person can do here. */
  steps: Array<{ id: OnboardingItemId; done: boolean }>
  collapsed: boolean
  /** The report "Open report" goes to: the person's newest here, else a teammate's. */
  reportTarget: string | null
  /** The same, among reports in a project that sends to a tracker. */
  trackerTarget: string | null
}

const BONUS_ORDER: OnboardingMissionId[] = ["invite", "project", "comment", "tracker", "send", "agent"]
const ADMIN_ONLY = new Set<OnboardingMissionId>(["invite", "project", "tracker"])

async function exists(db: Db, query: { from: PgTable; where: SQL | undefined }): Promise<boolean> {
  const rows = await db.select({ one: sql`1` }).from(query.from).where(query.where).limit(1)
  return rows.length > 0
}

/** A project of this workspace uses a tracker (not a notifier): only then can a report be sent to one. */
function trackerProjects(db: Db, workspaceId: string) {
  return db
    .select({ id: project.id })
    .from(project)
    .innerJoin(integration, eq(integration.projectId, project.id))
    .where(and(eq(project.workspaceId, workspaceId), inArray(integration.provider, [...TRACKER_PROVIDERS])))
}

/** Whether a step or mission is done according to the other tables; null for steps only the dashboard reports. */
function derived(db: Db, id: OnboardingItemId, userId: string, workspaceId: string): Promise<boolean> | null {
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

/** The newest ready report here, the person's own first; optionally only among `projectIds`. */
async function target(db: Db, userId: string, workspaceId: string, projectIds?: string[]): Promise<string | null> {
  if (projectIds?.length === 0) return null
  const [row] = await db
    .select({ id: report.id })
    .from(report)
    .where(
      and(
        eq(report.workspaceId, workspaceId),
        eq(report.uploadStatus, "ready"),
        projectIds ? inArray(report.projectId, projectIds) : undefined,
      ),
    )
    .orderBy(sql`${report.reporterId} = ${userId} desc`, desc(report.createdAt))
    .limit(1)
  return row?.id ?? null
}

/**
 * The person's checklist in a workspace, or null when they have none (an account from before it, or one
 * that finished). Whatever the other tables show done is written down, so it stays done.
 */
export async function onboardingProgress(db: Db, userId: string, workspaceId: string): Promise<OnboardingProgress | null> {
  const [row] = await db.select({ onboarding: user.onboarding }).from(user).where(eq(user.id, userId))
  const state = row?.onboarding
  if (!state || state.completedAt) return null

  const isAdmin = (await memberRole(db, userId, workspaceId)) === "admin"
  const projectIds = (await trackerProjects(db, workspaceId)).map((item) => item.id)
  const missions = BONUS_ORDER.filter((id) => (isAdmin || !ADMIN_ONLY.has(id)) && (id !== "send" || projectIds.length > 0))

  const stored = { ...state.steps }
  const now = new Date().toISOString()
  const fresh: Partial<Record<OnboardingItemId, string>> = {}
  await Promise.all(
    [...ONBOARDING_STEPS, ...missions]
      .filter((id) => !stored[id])
      .map(async (id) => {
        if (await derived(db, id, userId, workspaceId)) fresh[id] = now
      }),
  )
  const steps = { ...stored, ...fresh }
  const required = ONBOARDING_STEPS.every((id) => steps[id])
  const phase: OnboardingPhase = !required ? "required" : state.celebratedAt ? "bonus" : "celebrate"
  const shown = phase === "bonus" ? missions : [...ONBOARDING_STEPS]
  const completed = phase === "bonus" && missions.every((id) => steps[id])

  if (Object.keys(fresh).length > 0 || completed) {
    const next: OnboardingState = { ...state, steps, ...(completed ? { completedAt: now } : {}) }
    await db.update(user).set({ onboarding: next }).where(eq(user.id, userId))
  }
  if (completed) return null

  return {
    phase,
    steps: shown.map((id) => ({ id, done: Boolean(steps[id]) })),
    collapsed: state.collapsed === true,
    reportTarget: await target(db, userId, workspaceId),
    trackerTarget: await target(db, userId, workspaceId, projectIds),
  }
}
