import {
  canUseInternal,
  DEBUGGER_CONTENT_TYPE,
  defaultReportTitle,
  emailDomain,
  MAX_THUMBNAIL_BYTES,
  MEDIA_TYPES,
  THUMBNAIL_CONTENT_TYPE,
} from "@bugberry/shared"
import { withTransaction } from "../../db/client"
import type { AppDeps } from "../../deps"
import type { CurrentUser } from "../../plugins/auth"
import { badRequest, conflict, notFound, payloadTooLarge, unprocessable } from "../../lib/errors"
import { newId, newShareSlug } from "../../lib/ids"
import { notifyNewReport } from "../notifiers/deliver"
import type { createDispatcher } from "../trackers/dispatch"
import { debuggerKeyFor, mediaKeyFor, thumbnailKeyFor } from "../../storage/keys"
import { PART_BYTES, partSizes } from "../../storage/multipart"
import type { UploadTarget } from "../../storage/types"
import { resolveWorkspace } from "../workspaces/access"
import { assertCanCreateReport } from "../workspaces/limits"
import { afterFinalize } from "./after-finalize"
import type { CreateUploadBody } from "./model"
import { projectInWorkspace } from "../projects/repository"
import {
  claimReportNumber,
  findReport,
  findUploadState,
  insertReport,
  lockMediaUpload,
  lockWorkspaceForReports,
  markUploadReady,
  type ReportRow,
  updateReport,
} from "./repository"

type Deps = Pick<AppDeps, "config" | "db" | "storage">
export type { ReportRow } from "./repository"

/** Where the client sends a report's files; media goes in parts or in one PUT, never both. */
export interface UploadTargets {
  mediaUpload: UploadTarget | null
  mediaParts: { partSize: number; parts: UploadTarget[] } | null
  debuggerUpload: UploadTarget | null
  thumbnailUpload: UploadTarget | null
}

export function reportLinks(appUrl: string, row: { id: string; shareSlug: string }) {
  return { reportUrl: `${appUrl}/app/r/${row.id}`, shareUrl: `${appUrl}/s/${row.shareSlug}` }
}

/**
 * Creates a report in `uploading` and signs the links its files go to: what `POST /reports/uploads` does after
 * its rate limit, shared with the MCP's createUpload. `viaAgent` names the AI app that recorded it.
 */
export async function createReportUpload(
  deps: Deps,
  user: CurrentUser,
  body: CreateUploadBody,
  opts: { viaAgent?: string } = {},
): Promise<{ reportId: string; number: number; reportUrl: string; shareUrl: string } & UploadTargets> {
  const { config, db, storage } = deps
  const maxMb = Math.floor(config.maxUploadBytes / 1024 / 1024)
  if (body.mediaSize > config.maxUploadBytes || (body.debuggerSize ?? 0) > config.maxUploadBytes) {
    throw payloadTooLarge(`Files must be at most ${maxMb} MB`)
  }
  // Checked here too, not only by the REST body: the MCP's createUpload reaches this without it.
  if ((body.thumbnailSize ?? 0) > MAX_THUMBNAIL_BYTES) throw payloadTooLarge("Thumbnail must be at most 1 MB")
  if (body.captureType === "video" && body.durationMs === undefined) {
    throw badRequest("duration_required", "durationMs is required for video reports")
  }
  const workspaceId = await resolveWorkspace(db, user, body.workspaceId)
  if (body.visibility === "internal" && !canUseInternal(user.email)) {
    throw unprocessable("internal_unavailable", "Internal sharing needs a company email domain")
  }
  if (body.projectId) {
    if (!(await projectInWorkspace(db, body.projectId, workspaceId))) {
      throw unprocessable("project_not_found", "Project not found in this workspace")
    }
  }

  // Only a file too big for one part is worth the extra requests.
  const multipart = body.multipart && body.mediaSize > PART_BYTES ? storage.multipart : undefined
  const id = newId()
  const mediaType = MEDIA_TYPES[body.captureType]
  const mediaKey = mediaKeyFor(id, body.captureType)
  const debuggerKey = body.debuggerSize ? debuggerKeyFor(id) : null
  const thumbnailKey = body.thumbnailSize ? thumbnailKeyFor(id) : null

  const created = await withTransaction(db, async () => {
    const number = await claimReportNumber(db, workspaceId)
    // Counted after the claim, which locks the workspace row: uploads at the same time take turns here.
    await assertCanCreateReport(db, config, workspaceId, body.captureType, body.durationMs ?? null)
    return insertReport(db, {
      id,
      workspaceId,
      number,
      projectId: body.projectId ?? null,
      reporterId: user.id,
      reporterDomain: emailDomain(user.email),
      title: body.title?.trim() || defaultReportTitle(body.captureType, user.name),
      description: body.description ?? "",
      priority: body.priority ?? "none",
      visibility: body.visibility ?? "workspace",
      shareSlug: newShareSlug(),
      captureType: body.captureType,
      pageUrl: body.pageUrl,
      pageTitle: body.pageTitle ?? "",
      device: body.device,
      durationMs: body.durationMs ?? null,
      mediaKey,
      mediaType,
      mediaSize: body.mediaSize,
      debuggerKey,
      debuggerSize: body.debuggerSize ?? null,
      thumbnailKey,
      thumbnailSize: body.thumbnailSize ?? null,
      debuggerSummary: body.debuggerSummary,
      viaAgent: opts.viaAgent ?? null,
    })
  })
  if (!created) throw new Error("Failed to create report")

  let mediaUpload: UploadTarget | null = null
  let mediaParts: UploadTargets["mediaParts"] = null
  if (multipart) {
    const { uploadId, parts } = await multipart.create(mediaKey, { contentType: mediaType, partSizes: partSizes(body.mediaSize) })
    try {
      await updateReport(db, created.id, { mediaUploadId: uploadId })
    } catch (error) {
      await multipart.abort(mediaKey, uploadId).catch(() => undefined)
      throw error
    }
    mediaParts = { partSize: PART_BYTES, parts }
  } else {
    mediaUpload = await storage.createUploadTarget(mediaKey, { contentType: mediaType, maxBytes: body.mediaSize })
  }
  const debuggerUpload =
    debuggerKey && body.debuggerSize
      ? await storage.createUploadTarget(debuggerKey, { contentType: DEBUGGER_CONTENT_TYPE, maxBytes: body.debuggerSize })
      : null
  const thumbnailUpload =
    thumbnailKey && body.thumbnailSize
      ? await storage.createUploadTarget(thumbnailKey, { contentType: THUMBNAIL_CONTENT_TYPE, maxBytes: body.thumbnailSize })
      : null

  return {
    reportId: created.id,
    number: created.number,
    ...reportLinks(config.appUrl, created),
    mediaUpload,
    mediaParts,
    debuggerUpload,
    thumbnailUpload,
  }
}

/** Fresh links for a report still uploading, signed for the sizes declared when it was created. */
export async function uploadTargetsFor({ storage }: Deps, row: ReportRow): Promise<UploadTargets> {
  let mediaUpload: UploadTarget | null = null
  let mediaParts: UploadTargets["mediaParts"] = null
  if (row.mediaUploadId && storage.multipart) {
    mediaParts = { partSize: PART_BYTES, parts: storage.multipart.signParts(row.mediaKey, row.mediaUploadId, partSizes(row.mediaSize)) }
  } else {
    mediaUpload = await storage.createUploadTarget(row.mediaKey, { contentType: row.mediaType, maxBytes: row.mediaSize })
  }
  const debuggerUpload =
    row.debuggerKey && row.debuggerSize
      ? await storage.createUploadTarget(row.debuggerKey, { contentType: DEBUGGER_CONTENT_TYPE, maxBytes: row.debuggerSize })
      : null
  const thumbnailUpload =
    row.thumbnailKey && row.thumbnailSize
      ? await storage.createUploadTarget(row.thumbnailKey, { contentType: THUMBNAIL_CONTENT_TYPE, maxBytes: row.thumbnailSize })
      : null
  return { mediaUpload, mediaParts, debuggerUpload, thumbnailUpload }
}

/** Deletes whatever arrived and marks the upload failed: the client starts over with a new report. */
async function failUpload({ db, storage }: Deps, row: ReportRow, message: string): Promise<never> {
  const keys = [row.mediaKey, row.debuggerKey, row.thumbnailKey].filter((key): key is string => key !== null)
  await Promise.all(keys.map((key) => storage.delete(key).catch(() => undefined)))
  await updateReport(db, row.id, { uploadStatus: "failed", uploadError: message, mediaUploadId: null })
  throw unprocessable("upload_size_mismatch", message)
}

/**
 * Joins media sent in parts into one object, which the size checks of finalize then treat like any upload. The
 * report row stays locked while the storage joins the parts: a second finalize at the same time (a retry after a
 * timeout) waits for the first, then finds the parts joined and doesn't join them again.
 */
async function joinMediaParts(deps: Deps, row: ReportRow): Promise<void> {
  const { db, storage } = deps
  const multipart = storage.multipart
  if (!multipart) throw new Error("The storage can't finish an upload in parts (was STORAGE_DRIVER changed?)")
  const joined = await withTransaction(db, async () => {
    const uploadId = await lockMediaUpload(db, row.id)
    // Joined, or failed, by the finalize this one waited for.
    if (!uploadId) return null
    const result = await multipart.complete(row.mediaKey, uploadId, partSizes(row.mediaSize))
    if (result === "completed") await updateReport(db, row.id, { mediaUploadId: null })
    return { result, uploadId }
  })
  if (joined?.result === "incomplete") {
    throw conflict("upload_incomplete", "Upload has not finished yet; retry the upload, then finalize again")
  }
  if (joined?.result === "mismatch") {
    await multipart.abort(row.mediaKey, joined.uploadId).catch(() => undefined)
    await failUpload(deps, row, "An uploaded part did not match its declared size")
  }
  // "gone" changes nothing: a finalize joined them but stopped before saving (the object is there), or the storage
  // dropped them (upload_incomplete below says so). Never failed and deleted on this alone.
}

/**
 * Checks the files a report's upload declared and makes it ready: the body of `/reports/:id/finalize` after its
 * access checks, shared with agent upload links. Notifications and auto-send go out once, after the first finalize.
 */
export async function finalizeReportUpload(
  deps: AppDeps,
  dispatcher: ReturnType<typeof createDispatcher>,
  reportId: string,
): Promise<{ id: string; uploadStatus: "ready"; reportUrl: string; shareUrl: string }> {
  const { config, db, storage } = deps
  const row = await findReport(db, reportId)
  if (!row) throw notFound("report_not_found", "Report not found")
  const ready = () => ({ id: row.id, uploadStatus: "ready" as const, ...reportLinks(config.appUrl, row) })
  // A failed upload only comes from a size mismatch below or in joinMediaParts; answer a retry the same way.
  if (row.uploadStatus === "failed") {
    throw unprocessable("upload_size_mismatch", row.uploadError ?? "Uploaded file size did not match")
  }
  if (row.uploadStatus === "ready") return ready()

  if (row.mediaUploadId) await joinMediaParts(deps, row)

  const expected = [{ key: row.mediaKey, size: row.mediaSize }]
  if (row.debuggerKey && row.debuggerSize) expected.push({ key: row.debuggerKey, size: row.debuggerSize })

  for (const file of expected) {
    const info = await storage.head(file.key)
    if (!info) {
      throw conflict("upload_incomplete", "Upload has not finished yet; retry the upload, then finalize again")
    }
    if (info.size !== file.size) {
      await failUpload(deps, row, `Uploaded file is ${info.size} bytes but ${file.size} bytes were declared`)
    }
  }

  // The thumbnail is a preview, never a reason to fail: one that did not arrive intact is dropped.
  let keepThumbnail = false
  if (row.thumbnailKey) {
    // A storage error while checking only costs the preview, never the report.
    const info = await storage.head(row.thumbnailKey).catch(() => null)
    keepThumbnail = info !== null && info.size === row.thumbnailSize
    if (!keepThumbnail) await storage.delete(row.thumbnailKey).catch(() => undefined)
  }
  const madeReady = await withTransaction(db, async () => {
    // Locks the workspace row as an upload does, so finalizes and new uploads take turns at the count.
    await lockWorkspaceForReports(db, row.workspaceId)
    await assertCanCreateReport(db, config, row.workspaceId, row.captureType, row.durationMs, row.id)
    return markUploadReady(db, row.id, keepThumbnail)
  })
  if (!madeReady) {
    // The other finalize got there first; it also sends the notifications, so they go out once.
    const now = await findUploadState(db, row.id)
    if (!now) throw notFound("report_not_found", "Report not found")
    if (now.uploadStatus !== "ready") {
      throw unprocessable("upload_size_mismatch", now.uploadError ?? "Uploaded file size did not match")
    }
    return ready()
  }
  // In the background: a slow tracker must not delay the client.
  afterFinalize(deps, row.id, async () => {
    // Side by side and each on its own: a slow or failing tracker must not keep the channels waiting.
    await Promise.all([
      dispatcher.autoSend(row.id).catch((error) => console.error("auto-send failed", { reportId: row.id, error })),
      notifyNewReport(deps, row.id).catch((error) => console.error("notify failed", { reportId: row.id, error })),
    ])
  })
  return ready()
}
