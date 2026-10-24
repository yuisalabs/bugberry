import { clockLabel, tooLong } from "@bugberry/shared"
import { ApiError, type BugberryApi } from "./api"
import type { ReportDraft } from "./types"

type ServerLimits = Extract<Awaited<ReturnType<BugberryApi["workspaceLimits"]>>, { limited: true }>

/**
 * A workspace's usage under the server's ACCOUNT_LIMITS, or `{ limited: false }`. Servers before 0.8.0 name no
 * recording length (0.5.0 to 0.7.x send storage and file sizes instead, which are no longer limits).
 */
export type WorkspaceLimits = { limited: false } | (Omit<ServerLimits, "maxRecordingMs"> & Partial<Pick<ServerLimits, "maxRecordingMs">>)
export type CaptureKind = "screenshot" | "video"

/**
 * The workspace's limits; `{ limited: false }` for a server without them (404), null when unknown.
 * Unknown shows nothing and never blocks a send: the server still decides.
 */
export async function limitsFor(api: { workspaceLimits(workspaceId: string): Promise<WorkspaceLimits> }, workspaceId: string): Promise<WorkspaceLimits | null> {
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

/** Why a recording can't go to this workspace: longer than it takes. Null when it fits, or without a length. */
export function lengthWarning(
  limits: WorkspaceLimits | null,
  durationMs: number,
  who: { isAdmin: boolean; hasOtherWorkspaces: boolean },
): string | null {
  if (!limits?.limited || limits.maxRecordingMs === undefined || !tooLong(durationMs, limits.maxRecordingMs)) return null
  const elsewhere = who.hasOtherWorkspaces ? ", or pick another workspace" : ""
  return `This recording is ${clockLabel(durationMs)}; this workspace takes recordings up to ${clockLabel(limits.maxRecordingMs)}. Trim it or record a shorter one${elsewhere}.`
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
  durationMs = 0,
): boolean {
  const tooLongHere = kind === "video" && lengthWarning(limits, durationMs, { isAdmin: false, hasOtherWorkspaces: false }) !== null
  if (!isFull(limits, kind) && !tooLongHere) return false
  return !resuming(currentDraft, workspaceId)
}

/** A draft resuming its own upload into this workspace: that report is already counted, the server decides. */
export function resuming(currentDraft: Pick<ReportDraft, "session" | "form"> | null, workspaceId: string | null): boolean {
  return Boolean(currentDraft?.session && workspaceId !== null && currentDraft.form?.workspaceId === workspaceId)
}
