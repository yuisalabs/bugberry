import { sizeLabel } from "@bugberry/shared"
import { ApiError, type BugberryApi } from "./api"
import type { ReportDraft } from "./types"

type ServerLimits = Extract<Awaited<ReturnType<BugberryApi["workspaceLimits"]>>, { limited: true }>
type SizeLimits = Pick<ServerLimits, "storage" | "maxFileBytes">

/**
 * A workspace's usage under the server's ACCOUNT_LIMITS, or `{ limited: false }`. Servers before 0.5.0 limit
 * no sizes, so they send no storage or file size.
 */
export type WorkspaceLimits = { limited: false } | (Omit<ServerLimits, keyof SizeLimits> & Partial<SizeLimits>)
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

/**
 * "Screenshots 3/5 · Recordings 5/5 · 120 MB of 250 MB" (popup), or one kind's "Recordings 5/5 · 120 MB of 250 MB"
 * (review); null without limits.
 */
export function usageLine(limits: WorkspaceLimits | null, kind?: CaptureKind): string | null {
  if (!limits?.limited) return null
  const one = (each: CaptureKind) => {
    const count = countOf(limits, each)
    return `${each === "video" ? "Recordings" : "Screenshots"} ${count.used}/${count.max}`
  }
  const counts = kind ? one(kind) : `${one("screenshot")} · ${one("video")}`
  return limits.storage ? `${counts} · ${sizeLabel(limits.storage.used)} of ${sizeLabel(limits.storage.max)}` : counts
}

/** Below this much room a workspace counts as out of storage: no capture would fit. */
export const MIN_ROOM_BYTES = 1024 * 1024

/** Bytes the workspace has left; null when its storage isn't limited. */
export function roomLeft(limits: WorkspaceLimits | null): number | null {
  if (!limits?.limited || !limits.storage) return null
  return Math.max(0, limits.storage.max - limits.storage.used)
}

/**
 * How big a recording into this workspace may grow: 95% of its file limit or of the room left, whichever is
 * smaller, so the logs and the preview still fit. Null without size limits. A workspace out of room isn't
 * capped by it: the popup already warns, and the review says what to do.
 */
export function recordingCap(limits: WorkspaceLimits | null): number | null {
  if (!limits?.limited || limits.maxFileBytes === undefined) return null
  const room = roomLeft(limits)
  const cap = room !== null && room >= MIN_ROOM_BYTES ? Math.min(limits.maxFileBytes, room) : limits.maxFileBytes
  return Math.floor(cap * 0.95)
}

/** Why a report of `bytes` can't go to this workspace: a file over its limit, or more than the room left. */
export function sizeProblem(limits: WorkspaceLimits | null, bytes: number): "file" | "storage" | null {
  if (!limits?.limited) return null
  if (limits.maxFileBytes !== undefined && bytes > limits.maxFileBytes) return "file"
  if (limits.storage && limits.storage.used + bytes > limits.storage.max) return "storage"
  return null
}

/** What to do about a report too big for the workspace, worded like fullWarning. */
export function sizeWarning(
  limits: WorkspaceLimits | null,
  kind: CaptureKind,
  bytes: number,
  who: { isAdmin: boolean; hasOtherWorkspaces: boolean },
): string | null {
  const problem = sizeProblem(limits, bytes)
  if (!problem || !limits?.limited) return null
  const elsewhere = who.hasOtherWorkspaces ? ", or pick another workspace" : ""
  if (problem === "file") {
    const max = sizeLabel(limits.maxFileBytes ?? 0)
    const again = kind === "video" ? "Record a shorter one" : "Take a smaller one"
    return `This ${noun(kind, 1)} is ${sizeLabel(bytes)}; this workspace takes files up to ${max}. ${again}${elsewhere}.`
  }
  const left = sizeLabel(Math.max(0, (limits.storage?.max ?? 0) - (limits.storage?.used ?? 0)))
  const action = who.isAdmin ? "Delete a report in the dashboard to make room" : "Ask a workspace admin to delete a report"
  return `This ${noun(kind, 1)} needs ${sizeLabel(bytes)}, but this workspace has ${left} left. ${action}${elsewhere}.`
}

/** What to do about a full workspace, worded for who is asking: only admins can delete reports. */
export function fullWarning(
  limits: WorkspaceLimits | null,
  kind: CaptureKind,
  place: "popup" | "review",
  who: { isAdmin: boolean; hasOtherWorkspaces: boolean },
): string | null {
  if (!limits?.limited) return null
  if (!isFull(limits, kind)) {
    const room = roomLeft(limits)
    if (room === null || room >= MIN_ROOM_BYTES) return null
    const action = who.isAdmin ? "Delete a report in the dashboard to make room" : "Ask a workspace admin to delete a report"
    const elsewhere = who.hasOtherWorkspaces ? (place === "popup" ? ", or send to another workspace" : ", or pick another workspace") : ""
    return `This workspace has no storage left. ${action}${elsewhere}.`
  }
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
  bytes = 0,
): boolean {
  if (!isFull(limits, kind) && !sizeProblem(limits, bytes)) return false
  return !resuming(currentDraft, workspaceId)
}

/** A draft resuming its own upload into this workspace: that report is already counted, the server decides. */
export function resuming(currentDraft: Pick<ReportDraft, "session" | "form"> | null, workspaceId: string | null): boolean {
  return Boolean(currentDraft?.session && workspaceId !== null && currentDraft.form?.workspaceId === workspaceId)
}
