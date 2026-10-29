import { ONBOARDING_STEPS, TRACKER_PROVIDERS, type OnboardingEvent, type OnboardingItemId, type OnboardingMissionId } from "@bugberry/shared"
import { and, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import type { Db } from "../../db/client"
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
  const newest = async (mine: boolean) => {
    const [row] = await db
      .select({ id: report.id })
      .from(report)
      .where(
        and(
          eq(report.workspaceId, workspaceId),
          eq(report.uploadStatus, "ready"),
          mine ? eq(report.reporterId, userId) : undefined,
          projectIds ? inArray(report.projectId, projectIds) : undefined,
        ),
      )
      .orderBy(desc(report.createdAt))
      .limit(1)
    return row?.id ?? null
  }
  return (await newest(true)) ?? (await newest(false))
}

/** The steps whose button opens a report, and the one that opens a report in a project with a tracker. */
const OPENS_REPORT = new Set<OnboardingItemId>(["devtools", "shared", "comment"])

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
  // Missions are only looked at once they show; until then the five steps are all there is to check.
  const inBonus = ONBOARDING_STEPS.every((id) => stored[id]) && Boolean(state.celebratedAt)
  await Promise.all(
    [...ONBOARDING_STEPS, ...(inBonus ? missions : [])]
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
    // Onto the state as it is now: an event recorded while this ran must stay.
    await changeOnboarding(db, userId, (latest) => ({
      ...latest,
      steps: { ...fresh, ...latest.steps },
      ...(completed ? { completedAt: now } : {}),
    }))
  }
  if (completed) return null

  // Only the next item has a button, so only its report is looked up.
  const next = phase === "celebrate" ? undefined : shown.find((id) => !steps[id])
  return {
    phase,
    steps: shown.map((id) => ({ id, done: Boolean(steps[id]) })),
    collapsed: state.collapsed === true,
    reportTarget: next && OPENS_REPORT.has(next) ? await target(db, userId, workspaceId) : null,
    trackerTarget: next === "send" ? await target(db, userId, workspaceId, projectIds) : null,
  }
}

export type OnboardingChange = { event: OnboardingEvent } | { collapsed: boolean }

/**
 * What the dashboard reports: a step no table records (each written once), the celebration being seen (only
 * after the five steps), or the checklist collapsed. Nothing happens for someone without a checklist.
 */
export async function recordOnboarding(db: Db, userId: string, change: OnboardingChange): Promise<void> {
  const now = new Date().toISOString()
  await changeOnboarding(db, userId, (state) => {
    if ("collapsed" in change) return { ...state, collapsed: change.collapsed }
    if (change.event === "celebrated") {
      if (state.celebratedAt || !ONBOARDING_STEPS.every((id) => state.steps?.[id])) return null
      return { ...state, celebratedAt: now }
    }
    if (state.steps?.[change.event]) return null
    return { ...state, steps: { ...state.steps, [change.event]: now } }
  })
}

/**
 * Changes the checklist with the person's row locked, so two changes at once (a focus refresh and a click) both
 * land. `change` sees the state as it is now and answers null to leave it; nothing happens without a checklist.
 */
async function changeOnboarding(db: Db, userId: string, change: (state: OnboardingState) => OnboardingState | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ onboarding: user.onboarding }).from(user).where(eq(user.id, userId)).for("update")
    const state = row?.onboarding
    if (!state || state.completedAt) return
    const next = change(state)
    if (next) await tx.update(user).set({ onboarding: next }).where(eq(user.id, userId))
  })
}
