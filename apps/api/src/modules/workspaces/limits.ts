import { type CaptureType, clockLabel, tooLong } from "@bugberry/shared"
import type { AccountLimits, Config } from "../../config"
import type { Db } from "../../db/client"
import { AppError } from "../../lib/errors"
import { countKeptReports, countOwnedWorkspaces, ownerIsUnlimited, userIsUnlimited } from "./repository"

type LimitsConfig = Pick<Config, "accountLimits" | "uploadUrlTtlSeconds">

export type WorkspaceLimits =
  | { limited: false }
  | {
      limited: true
      screenshots: { used: number; max: number }
      recordings: { used: number; max: number }
      /** The longest recording the workspace takes. */
      maxRecordingMs: number
    }

/**
 * Whether ACCOUNT_LIMITS apply to this workspace: they follow its owner, so every member of an unlimited
 * account's workspace is exempt there. A workspace whose owner is gone is limited.
 */
export async function isWorkspaceLimited(db: Db, limits: AccountLimits | null, workspaceId: string): Promise<boolean> {
  if (!limits) return false
  return (await ownerIsUnlimited(db, workspaceId)) !== true
}

/** Reports of one kind the workspace keeps (see countKeptReports). */
export async function countReports(
  db: Db,
  workspaceId: string,
  captureType: CaptureType,
  uploadTtlSeconds: number,
  now = new Date(),
  except?: string,
): Promise<number> {
  return countKeptReports(db, { workspaceId, captureType, uploadTtlSeconds, now, except })
}

export async function workspaceLimits(db: Db, config: LimitsConfig, workspaceId: string): Promise<WorkspaceLimits> {
  const limits = config.accountLimits
  if (!limits || !(await isWorkspaceLimited(db, limits, workspaceId))) return { limited: false }
  return {
    limited: true,
    screenshots: { used: await countReports(db, workspaceId, "screenshot", config.uploadUrlTtlSeconds), max: limits.screenshots },
    recordings: { used: await countReports(db, workspaceId, "video", config.uploadUrlTtlSeconds), max: limits.recordings },
    maxRecordingMs: limits.recordingMs,
  }
}

/** Whether ACCOUNT_LIMITS apply to this person, and so to the workspaces they own. */
export async function isAccountLimited(db: Db, limits: AccountLimits | null, userId: string): Promise<boolean> {
  if (!limits) return false
  return (await userIsUnlimited(db, userId)) !== true
}

export async function canCreateWorkspace(db: Db, limits: AccountLimits | null, userId: string): Promise<boolean> {
  if (!limits || !(await isAccountLimited(db, limits, userId))) return true
  return (await countOwnedWorkspaces(db, userId)) < limits.ownedWorkspaces
}

/**
 * Refuses one more report of this kind, or a recording longer than the workspace takes (`durationMs` as the
 * extension declared it; MAX_UPLOAD_MB still bounds a file whatever it claims). On finalize, `except` is the report
 * itself: an upload that outlived its link stopped counting, so it is checked again before it becomes ready.
 */
export async function assertCanCreateReport(
  db: Db,
  config: LimitsConfig,
  workspaceId: string,
  captureType: CaptureType,
  durationMs: number | null,
  except?: string,
): Promise<void> {
  const limits = config.accountLimits
  if (!limits || !(await isWorkspaceLimited(db, limits, workspaceId))) return
  if (captureType === "video" && durationMs !== null && tooLong(durationMs, limits.recordingMs)) {
    throw new AppError(
      403,
      "duration_limit_reached",
      `This recording is ${clockLabel(durationMs)}; this workspace takes recordings up to ${clockLabel(limits.recordingMs)}. Trim it or record a shorter one.`,
    )
  }
  const max = captureType === "video" ? limits.recordings : limits.screenshots
  if ((await countReports(db, workspaceId, captureType, config.uploadUrlTtlSeconds, new Date(), except)) < max) return
  const message =
    captureType === "video"
      ? `This workspace already has ${max} ${max === 1 ? "recording" : "recordings"}, the most it can keep. Delete one in the dashboard to record a new one.`
      : `This workspace already has ${max} ${max === 1 ? "screenshot" : "screenshots"}, the most it can keep. Delete one in the dashboard to take a new one.`
  throw new AppError(403, "report_limit_reached", message)
}

/**
 * Refuses a new member. `"joiner"` is the person trying to get in: the owner's account limit is not theirs
 * to act on, so they get their own message.
 */
export async function assertCanAddMembers(
  db: Db,
  limits: AccountLimits | null,
  workspaceId: string,
  audience: "admin" | "joiner" = "admin",
): Promise<void> {
  if (!(await isWorkspaceLimited(db, limits, workspaceId))) return
  const message = audience === "joiner" ? "This workspace isn't taking new members." : "Inviting teammates isn't available on this account."
  throw new AppError(403, "members_not_allowed", message)
}

export async function assertCanCreateWorkspace(db: Db, limits: AccountLimits | null, userId: string): Promise<void> {
  if (!limits || (await canCreateWorkspace(db, limits, userId))) return
  const max = limits.ownedWorkspaces
  throw new AppError(403, "workspace_limit_reached", `Your account can own ${max} ${max === 1 ? "workspace" : "workspaces"}.`)
}
