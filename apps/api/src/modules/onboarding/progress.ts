import { ONBOARDING_STEPS, type OnboardingEvent, type OnboardingItemId, type OnboardingMissionId } from "@bugberry/shared"
import { type Db, withTransaction } from "../../db/client"
import type { OnboardingState } from "../../db/schema"
import { memberRole } from "../workspaces/access"
import {
  doneElsewhere,
  findOnboardingState,
  listTrackerProjects,
  lockOnboardingState,
  newestReadyReport,
  setOnboardingState,
} from "./repository"

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

/** The newest ready report here, the person's own first; optionally only among `projectIds`. */
async function target(db: Db, userId: string, workspaceId: string, projectIds?: string[]): Promise<string | null> {
  if (projectIds?.length === 0) return null
  const newest = (mine: boolean) => newestReadyReport(db, { workspaceId, reporterId: mine ? userId : undefined, projectIds })
  return (await newest(true)) ?? (await newest(false))
}

/** The steps whose button opens a report, and the one that opens a report in a project with a tracker. */
const OPENS_REPORT = new Set<OnboardingItemId>(["devtools", "shared", "comment"])

/**
 * The person's checklist in a workspace, or null when they have none (an account from before it, or one
 * that finished). Whatever the other tables show done is written down, so it stays done.
 */
export async function onboardingProgress(db: Db, userId: string, workspaceId: string): Promise<OnboardingProgress | null> {
  const state = await findOnboardingState(db, userId)
  if (!state || state.completedAt) return null

  const isAdmin = (await memberRole(db, userId, workspaceId)) === "admin"
  const projectIds = await listTrackerProjects(db, workspaceId)
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
        if (await doneElsewhere(db, id, userId, workspaceId)) fresh[id] = now
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
  await withTransaction(db, async () => {
    const state = await lockOnboardingState(db, userId)
    if (!state || state.completedAt) return
    const next = change(state)
    if (next) await setOnboardingState(db, userId, next)
  })
}
