import type { CaptureType } from "@bugberry/shared"
import { and, count, eq, gt, ne, or } from "drizzle-orm"
import type { AccountLimits, Config } from "../config"
import type { Db } from "../db/client"
import { report, user, workspace } from "../db/schema"
import { AppError } from "../lib/errors"

/** Works with the database and with a transaction. */
type Reader = Pick<Db, "select">
type LimitsConfig = Pick<Config, "accountLimits" | "uploadUrlTtlSeconds">

export type WorkspaceLimits =
  | { limited: false }
  | { limited: true; screenshots: { used: number; max: number }; recordings: { used: number; max: number } }

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
 * Reports of one kind the workspace keeps: ready ones, and uploads started within the upload link's
 * lifetime. An older unfinished upload can't be seen or deleted, so it stops counting once its link expires.
 * `except` leaves one report out: the one being finalized.
 */
export async function countReports(
  db: Reader,
  workspaceId: string,
  captureType: CaptureType,
  uploadTtlSeconds: number,
  now = new Date(),
  except?: string,
): Promise<number> {
  const since = new Date(now.getTime() - uploadTtlSeconds * 1000)
  const [row] = await db
    .select({ value: count() })
    .from(report)
    .where(
      and(
        eq(report.workspaceId, workspaceId),
        eq(report.captureType, captureType),
        or(eq(report.uploadStatus, "ready"), and(eq(report.uploadStatus, "uploading"), gt(report.createdAt, since))),
        except ? ne(report.id, except) : undefined,
      ),
    )
  return row?.value ?? 0
}

export async function workspaceLimits(db: Reader, config: LimitsConfig, workspaceId: string): Promise<WorkspaceLimits> {
  const limits = config.accountLimits
  if (!limits || !(await isWorkspaceLimited(db, limits, workspaceId))) return { limited: false }
  return {
    limited: true,
    screenshots: { used: await countReports(db, workspaceId, "screenshot", config.uploadUrlTtlSeconds), max: limits.screenshots },
    recordings: { used: await countReports(db, workspaceId, "video", config.uploadUrlTtlSeconds), max: limits.recordings },
  }
}

export async function canCreateWorkspace(db: Reader, limits: AccountLimits | null, userId: string): Promise<boolean> {
  if (!limits) return true
  const [person] = await db.select({ unlimited: user.unlimited }).from(user).where(eq(user.id, userId)).limit(1)
  if (person?.unlimited) return true
  const [owned] = await db.select({ value: count() }).from(workspace).where(eq(workspace.ownerId, userId))
  return (owned?.value ?? 0) < limits.ownedWorkspaces
}

/**
 * Refuses one more report of this kind. On finalize, `except` is the report itself: an upload that outlived its
 * link stopped counting, so it is checked again before it becomes ready.
 */
export async function assertCanCreateReport(
  db: Reader,
  config: LimitsConfig,
  workspaceId: string,
  captureType: CaptureType,
  except?: string,
): Promise<void> {
  const limits = config.accountLimits
  if (!limits || !(await isWorkspaceLimited(db, limits, workspaceId))) return
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
