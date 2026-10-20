import { ApiError, type BugberryApi } from "./api"
import type { ReportDraft } from "./types"

/** A workspace's usage under the server's ACCOUNT_LIMITS, or `{ limited: false }`. */
export type WorkspaceLimits = Awaited<ReturnType<BugberryApi["workspaceLimits"]>>
export type CaptureKind = "screenshot" | "video"

/**
 * The workspace's limits; `{ limited: false }` for a server without them (404), null when unknown.
 * Unknown shows nothing and never blocks a send: the server still decides.
 */
export async function limitsFor(api: Pick<BugberryApi, "workspaceLimits">, workspaceId: string): Promise<WorkspaceLimits | null> {
  try {
    return await api.workspaceLimits(workspaceId)
  } catch (error) {
    return error instanceof ApiError && error.status === 404 ? { limited: false } : null
  }
}

const countOf = (limits: Extract<WorkspaceLimits, { limited: true }>, kind: CaptureKind) =>
  kind === "video" ? limits.recordings : limits.screenshots

const noun = (kind: CaptureKind, count: number) => `${kind === "video" ? "recording" : "screenshot"}${count === 1 ? "" : "s"}`

export function isFull(limits: WorkspaceLimits | null, kind: CaptureKind): boolean {
  if (!limits?.limited) return false
  const count = countOf(limits, kind)
  return count.used >= count.max
}

/** "Screenshots 3/5 · Recordings 5/5" (popup), or one kind's "Recordings 5/5" (review); null without limits. */
export function usageLine(limits: WorkspaceLimits | null, kind?: CaptureKind): string | null {
  if (!limits?.limited) return null
  const one = (each: CaptureKind) => {
    const count = countOf(limits, each)
    return `${each === "video" ? "Recordings" : "Screenshots"} ${count.used}/${count.max}`
  }
  return kind ? one(kind) : `${one("screenshot")} · ${one("video")}`
}

/** What to do about a full workspace, worded for who is asking: only admins can delete reports. */
export function fullWarning(
  limits: WorkspaceLimits | null,
  kind: CaptureKind,
  place: "popup" | "review",
  who: { isAdmin: boolean; hasOtherWorkspaces: boolean },
): string | null {
  if (!limits?.limited || !isFull(limits, kind)) return null
  const { max } = countOf(limits, kind)
  const fact = place === "popup" ? `This workspace is full for ${noun(kind, 2)}.` : `This workspace already has ${max} ${noun(kind, max)}.`
  const action = who.isAdmin ? "Delete one in the dashboard" : "Ask a workspace admin to delete one"
  const elsewhere = who.hasOtherWorkspaces ? (place === "popup" ? ", or send to another workspace" : ", or pick another workspace") : ""
  return `${fact} ${action}${elsewhere}.`
}

/**
 * Whether "Create report" waits for a free slot. A draft resuming its own upload into this workspace never
 * waits: that report is already counted, and the server decides at finalize.
 */
export function sendBlocked(
  limits: WorkspaceLimits | null,
  kind: CaptureKind,
  currentDraft: Pick<ReportDraft, "session" | "form"> | null,
  workspaceId: string | null,
): boolean {
  if (!isFull(limits, kind)) return false
  return !(currentDraft?.session && workspaceId !== null && currentDraft.form?.workspaceId === workspaceId)
}
