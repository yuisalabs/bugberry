import { type CaptureKind, fullWarning, lengthWarning, sendBlocked, usageLine, type WorkspaceLimits } from "../server/limits"
import type { ReportDraft } from "../shared/types"

/** What the review shows about the selected workspace's limits. */
export interface LimitNote {
  usage: string | null
  warning: string | null
  /** "Create report" waits for a free slot. */
  blocked: boolean
  /** Only admins can delete reports, so only they get "Open dashboard". */
  admin: boolean
  /** The whole recording, untrimmed, is longer than the workspace takes: it can't be sent in place of the trim. */
  fullTooLong: boolean
}

export const NO_LIMIT_NOTE: LimitNote = { usage: null, warning: null, blocked: false, admin: false, fullTooLong: false }

export interface ReviewLimitsDeps {
  kind: CaptureKind
  /** The recording's length as it would be sent (trimmed), checked against the longest the workspace takes. */
  durationMs?: number
  /** The whole recording's length, untrimmed. */
  fullDurationMs?: number
  workspaces: readonly { id: string; role: string }[]
  fetchLimits(workspaceId: string): Promise<WorkspaceLimits | null>
  /** The draft as stored now: a failed send may have started its own upload since the review opened. */
  currentDraft(): Promise<Pick<ReportDraft, "session" | "form"> | null>
  onChange(note: LimitNote): void
}

/**
 * Keeps the review's limit note for the selected workspace. Only the newest refresh may answer, so a slow
 * reply for a workspace left behind, or an older reply for the same one, never brings back a stale state.
 */
export function createReviewLimits(deps: ReviewLimitsDeps, initialWorkspaceId: string | null) {
  let selected = initialWorkspaceId
  let latest = 0

  const refresh = async (): Promise<void> => {
    const workspaceId = selected
    const ask = ++latest
    if (!workspaceId) return
    const limits = await deps.fetchLimits(workspaceId)
    const draft = await deps.currentDraft()
    if (ask !== latest) return
    const role = deps.workspaces.find((entry) => entry.id === workspaceId)?.role
    const who = { isAdmin: role === "admin", hasOtherWorkspaces: deps.workspaces.length > 1 }
    const durationMs = deps.kind === "video" ? (deps.durationMs ?? 0) : 0
    const blocked = sendBlocked(limits, deps.kind, draft, workspaceId, durationMs)
    // A draft resuming its own upload isn't held back, so it gets no warning either.
    deps.onChange({
      usage: usageLine(limits, deps.kind),
      warning: blocked ? (fullWarning(limits, deps.kind, "review", who) ?? lengthWarning(limits, durationMs, who)) : null,
      blocked,
      admin: who.isAdmin,
      fullTooLong: deps.kind === "video" && lengthWarning(limits, deps.fullDurationMs ?? 0, who) !== null,
    })
  }

  return {
    refresh,
    /** A new workspace starts clear: the previous one's "full" must not hold back "Create report". */
    select(workspaceId: string): Promise<void> {
      selected = workspaceId
      deps.onChange(NO_LIMIT_NOTE)
      return refresh()
    },
    selected: () => selected,
  }
}

/**
 * The dashboard lists its current workspace's reports, so it is switched to this one first. The tab is
 * opened by the extension, not window.open: it can't be popup-blocked after the wait.
 */
export async function openDashboardFor(
  workspaceId: string,
  serverUrl: string,
  deps: { setCurrentWorkspace(workspaceId: string): Promise<unknown>; openTab(url: string): unknown },
): Promise<void> {
  await deps.setCurrentWorkspace(workspaceId).catch(() => {})
  deps.openTab(`${serverUrl}/app`)
}
