import { type CaptureType, sizeLabel } from "@bugberry/shared"
import { and, count, eq, gt, ne, or, sql } from "drizzle-orm"
import type { AccountLimits, Config } from "../config"
import type { Db } from "../db/client"
import { report, user, workspace } from "../db/schema"
import { AppError } from "../lib/errors"

/** Works with the database and with a transaction. */
type Reader = Pick<Db, "select">
type LimitsConfig = Pick<Config, "accountLimits" | "uploadUrlTtlSeconds">

export type WorkspaceLimits =
  | { limited: false }
  | {
      limited: true
      screenshots: { used: number; max: number }
      recordings: { used: number; max: number }
      /** Bytes the workspace's reports take up, all files counted. */
      storage: { used: number; max: number }
      /** The largest file one report may upload, in bytes. */
      maxFileBytes: number
    }

/**
 * Whether ACCOUNT_LIMITS apply to this workspace: they follow its owner, so every member of an unlimited
 * account's workspace is exempt there. A workspace whose owner is gone is limited.
 */
export async function isWorkspaceLimited(db: Reader, limits: AccountLimits | null, workspaceId: string): Promise<boolean> {
  if (!limits) return false
  const [row] = await db
    .select({ unlimited: user.unlimited })
    .from(workspace)
    .leftJoin(user, eq(user.id, workspace.ownerId))
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return row?.unlimited !== true
}

/**
 * The reports a workspace keeps: ready ones, and uploads started within the upload link's lifetime. An older
 * unfinished upload can't be seen or deleted, so it stops counting once its link expires. `except` leaves one
 * report out: the one being finalized.
 */
function kept(workspaceId: string, uploadTtlSeconds: number, now: Date, except?: string) {
  const since = new Date(now.getTime() - uploadTtlSeconds * 1000)
  return and(
    eq(report.workspaceId, workspaceId),
    or(eq(report.uploadStatus, "ready"), and(eq(report.uploadStatus, "uploading"), gt(report.createdAt, since))),
    except ? ne(report.id, except) : undefined,
  )
}

/** Reports of one kind the workspace keeps. */
export async function countReports(
  db: Reader,
  workspaceId: string,
  captureType: CaptureType,
  uploadTtlSeconds: number,
  now = new Date(),
  except?: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(report)
    .where(and(kept(workspaceId, uploadTtlSeconds, now, except), eq(report.captureType, captureType)))
  return row?.value ?? 0
}

/** Bytes the reports the workspace keeps take up: the media, the logs and the preview, as declared at upload. */
export async function storageUsed(
  db: Reader,
  workspaceId: string,
  uploadTtlSeconds: number,
  now = new Date(),
  except?: string,
): Promise<number> {
  const [row] = await db
    .select({
      value: sql<string | null>`sum(${report.mediaSize} + coalesce(${report.debuggerSize}, 0) + coalesce(${report.thumbnailSize}, 0))`,
    })
    .from(report)
    .where(kept(workspaceId, uploadTtlSeconds, now, except))
  return Number(row?.value ?? 0)
}


export async function workspaceLimits(db: Reader, config: LimitsConfig, workspaceId: string): Promise<WorkspaceLimits> {
  const limits = config.accountLimits
  if (!limits || !(await isWorkspaceLimited(db, limits, workspaceId))) return { limited: false }
  return {
    limited: true,
    screenshots: { used: await countReports(db, workspaceId, "screenshot", config.uploadUrlTtlSeconds), max: limits.screenshots },
    recordings: { used: await countReports(db, workspaceId, "video", config.uploadUrlTtlSeconds), max: limits.recordings },
    storage: { used: await storageUsed(db, workspaceId, config.uploadUrlTtlSeconds), max: limits.storageBytes },
    maxFileBytes: limits.fileBytes,
  }
}

/** Whether ACCOUNT_LIMITS apply to this person, and so to the workspaces they own. */
export async function isAccountLimited(db: Reader, limits: AccountLimits | null, userId: string): Promise<boolean> {
  if (!limits) return false
  const [person] = await db.select({ unlimited: user.unlimited }).from(user).where(eq(user.id, userId)).limit(1)
  return person?.unlimited !== true
}

export async function canCreateWorkspace(db: Reader, limits: AccountLimits | null, userId: string): Promise<boolean> {
  if (!limits || !(await isAccountLimited(db, limits, userId))) return true
  const [owned] = await db.select({ value: count() }).from(workspace).where(eq(workspace.ownerId, userId))
  return (owned?.value ?? 0) < limits.ownedWorkspaces
}

/** The files one report uploads, in bytes. */
export interface ReportSizes {
  media: number
  debugger?: number | null
  thumbnail?: number | null
}

/**
 * Refuses one more report of this kind, or one that is too big: a file over the per-file limit, or more than the
 * workspace has room for. On finalize, `except` is the report itself: an upload that outlived its link stopped
 * counting, so it is checked again before it becomes ready.
 */
export async function assertCanCreateReport(
  db: Reader,
  config: LimitsConfig,
  workspaceId: string,
  captureType: CaptureType,
  sizes: ReportSizes,
  except?: string,
): Promise<void> {
  const limits = config.accountLimits
  if (!limits || !(await isWorkspaceLimited(db, limits, workspaceId))) return
  const largest = Math.max(sizes.media, sizes.debugger ?? 0)
  if (largest > limits.fileBytes) {
    const what = captureType === "video" ? "recording" : "screenshot"
    throw new AppError(
      403,
      "file_limit_reached",
      `This ${what} is ${sizeLabel(largest)}; this workspace takes files up to ${sizeLabel(limits.fileBytes)}. ${captureType === "video" ? "Record a shorter one." : "Take a smaller one."}`,
    )
  }
  const total = sizes.media + (sizes.debugger ?? 0) + (sizes.thumbnail ?? 0)
  const used = await storageUsed(db, workspaceId, config.uploadUrlTtlSeconds, new Date(), except)
  if (used + total > limits.storageBytes) {
    const left = Math.max(0, limits.storageBytes - used)
    throw new AppError(
      403,
      "storage_limit_reached",
      `This report needs ${sizeLabel(total)}, but this workspace has ${sizeLabel(left)} of its ${sizeLabel(limits.storageBytes)} left. Delete a report in the dashboard to make room.`,
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
  db: Reader,
  limits: AccountLimits | null,
  workspaceId: string,
  audience: "admin" | "joiner" = "admin",
): Promise<void> {
  if (!(await isWorkspaceLimited(db, limits, workspaceId))) return
  const message = audience === "joiner" ? "This workspace isn't taking new members." : "Inviting teammates isn't available on this account."
  throw new AppError(403, "members_not_allowed", message)
}

export async function assertCanCreateWorkspace(db: Reader, limits: AccountLimits | null, userId: string): Promise<void> {
  if (!limits || (await canCreateWorkspace(db, limits, userId))) return
  const max = limits.ownedWorkspaces
  throw new AppError(403, "workspace_limit_reached", `Your account can own ${max} ${max === 1 ? "workspace" : "workspaces"}.`)
}
