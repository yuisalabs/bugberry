import { canUseInternal, DEBUGGER_CONTENT_TYPE, defaultReportTitle, emailDomain, MEDIA_TYPES, THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import { and, eq } from "drizzle-orm"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { project, report, workspace } from "../../db/schema"
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  payloadTooLarge,
  tooManyRequests,
  unprocessable,
} from "../../lib/errors"
import { newId, newShareSlug } from "../../lib/ids"
import { createRateLimiter } from "../../lib/rate-limit"
import { createDispatcher } from "../../lib/trackers/dispatch"
import { debuggerKeyFor, mediaKeyFor, thumbnailKeyFor } from "../../storage/keys"
import { PART_BYTES, partSizes } from "../../storage/multipart"
import type { UploadTarget } from "../../storage/types"
import { requireReportMember, resolveWorkspace } from "../../workspaces/access"
import { assertCanCreateReport } from "../../workspaces/limits"
import { createUploadBody } from "./model"
import { afterFinalize } from "./after-finalize"
import { claimReportNumber } from "./numbers"
import { trackerFactoryFor } from "../../lib/trackers/default"
import { notifyNewReport } from "../../lib/notifiers/deliver"

const UPLOAD_SESSIONS_PER_MINUTE = 30

type ReportRow = typeof report.$inferSelect

export function reportUploadsModule(deps: AppDeps) {
  const { config, db, storage } = deps
  const limiter = createRateLimiter({ limit: UPLOAD_SESSIONS_PER_MINUTE, windowMs: 60_000 })
  const dispatcher = createDispatcher({ ...deps, trackers: trackerFactoryFor(deps) })
  const linksFor = (row: { id: string; shareSlug: string }) => ({
    reportUrl: `${config.appUrl}/app/r/${row.id}`,
    shareUrl: `${config.appUrl}/s/${row.shareSlug}`,
  })

  /** Deletes whatever arrived and marks the upload failed: the client starts over with a new report. */
  const failUpload = async (row: ReportRow, message: string) => {
    const keys = [row.mediaKey, row.debuggerKey, row.thumbnailKey].filter((key): key is string => key !== null)
    await Promise.all(keys.map((key) => storage.delete(key).catch(() => undefined)))
    await db.update(report).set({ uploadStatus: "failed", uploadError: message, mediaUploadId: null }).where(eq(report.id, row.id))
    throw unprocessable("upload_size_mismatch", message)
  }

  /**
   * Joins media sent in parts into one object, which the size checks of finalize then treat like any upload. The
   * report row stays locked while the storage joins the parts: a second finalize at the same time (a retry after a
   * timeout) waits for the first, then finds the parts joined and doesn't join them again.
   */
  const joinMediaParts = async (row: ReportRow) => {
    const multipart = storage.multipart
    if (!multipart) throw new Error("The storage can't finish an upload in parts (was STORAGE_DRIVER changed?)")
    const joined = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ mediaUploadId: report.mediaUploadId })
        .from(report)
        .where(eq(report.id, row.id))
        .for("update")
      // Joined, or failed, by the finalize this one waited for.
      if (!locked?.mediaUploadId) return null
      const result = await multipart.complete(row.mediaKey, locked.mediaUploadId, partSizes(row.mediaSize))
      if (result === "completed") await tx.update(report).set({ mediaUploadId: null }).where(eq(report.id, row.id))
      return { result, uploadId: locked.mediaUploadId }
    })
    if (joined?.result === "incomplete") {
      throw conflict("upload_incomplete", "Upload has not finished yet; retry the upload, then finalize again")
    }
    if (joined?.result === "mismatch") {
      await multipart.abort(row.mediaKey, joined.uploadId).catch(() => undefined)
      await failUpload(row, "An uploaded part did not match its declared size")
    }
    // "gone" changes nothing here: the parts were joined by a finalize whose server stopped before it saved that, and
    // the object is there; or the storage dropped them, and the missing object answers upload_incomplete below.
    // Never failed and deleted on this alone.
  }

  return new Elysia()
    .use(authPlugin(deps))
    .post(
      "/reports/uploads",
      async ({ user, body }) => {
        if (!limiter.consume(user.id)) throw tooManyRequests()
        const maxMb = Math.floor(config.maxUploadBytes / 1024 / 1024)
        if (body.mediaSize > config.maxUploadBytes || (body.debuggerSize ?? 0) > config.maxUploadBytes) {
          throw payloadTooLarge(`Files must be at most ${maxMb} MB`)
        }
        if (body.captureType === "video" && body.durationMs === undefined) {
          throw badRequest("duration_required", "durationMs is required for video reports")
        }
        const workspaceId = await resolveWorkspace(db, user, body.workspaceId)
        if (body.visibility === "internal" && !canUseInternal(user.email)) {
          throw unprocessable("internal_unavailable", "Internal sharing needs a company email domain")
        }
        if (body.projectId) {
          const [target] = await db
            .select({ id: project.id })
            .from(project)
            .where(and(eq(project.id, body.projectId), eq(project.workspaceId, workspaceId)))
            .limit(1)
          if (!target) throw unprocessable("project_not_found", "Project not found in this workspace")
        }

        // Only a file too big for one part is worth the extra requests.
        const multipart = body.multipart && body.mediaSize > PART_BYTES ? storage.multipart : undefined
        const id = newId()
        const mediaType = MEDIA_TYPES[body.captureType]
        const mediaKey = mediaKeyFor(id, body.captureType)
        const debuggerKey = body.debuggerSize ? debuggerKeyFor(id) : null
        const thumbnailKey = body.thumbnailSize ? thumbnailKeyFor(id) : null

        const created = await db.transaction(async (tx) => {
          const number = await claimReportNumber(tx, workspaceId)
          // Counted after the claim, which locks the workspace row: uploads at the same time take turns here.
          await assertCanCreateReport(tx, config, workspaceId, body.captureType, body.durationMs ?? null)
          const [row] = await tx
            .insert(report)
            .values({
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
            })
            .returning({ id: report.id, shareSlug: report.shareSlug })
          return row
        })
        if (!created) throw new Error("Failed to create report")

        let mediaUpload: UploadTarget | null = null
        let mediaParts: { partSize: number; parts: UploadTarget[] } | null = null
        if (multipart) {
          const { uploadId, parts } = await multipart.create(mediaKey, { contentType: mediaType, partSizes: partSizes(body.mediaSize) })
          try {
            await db.update(report).set({ mediaUploadId: uploadId }).where(eq(report.id, created.id))
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
            ? await storage.createUploadTarget(debuggerKey, {
                contentType: DEBUGGER_CONTENT_TYPE,
                maxBytes: body.debuggerSize,
              })
            : null

        const thumbnailUpload =
          thumbnailKey && body.thumbnailSize
            ? await storage.createUploadTarget(thumbnailKey, {
                contentType: THUMBNAIL_CONTENT_TYPE,
                maxBytes: body.thumbnailSize,
              })
            : null

        return { reportId: created.id, ...linksFor(created), mediaUpload, mediaParts, debuggerUpload, thumbnailUpload }
      },
      { auth: true, body: createUploadBody },
    )
    .post(
      "/reports/:id/parts",
      async ({ user, params }) => {
        // Links for media in parts are signed when the upload starts and last UPLOAD_URL_TTL_SECONDS; on a slow
        // connection the last parts are sent after that, so the client asks here for new ones and goes on.
        await requireReportMember(db, user.id, params.id)
        const [row] = await db.select().from(report).where(eq(report.id, params.id)).limit(1)
        if (!row) throw notFound("report_not_found", "Report not found")
        if (row.reporterId !== user.id) throw forbidden("Only the reporter can upload to this report")
        const multipart = storage.multipart
        if (row.uploadStatus !== "uploading" || !row.mediaUploadId || !multipart) {
          throw conflict("not_in_parts", "This report has no upload in parts to go on with")
        }
        return { partSize: PART_BYTES, parts: multipart.signParts(row.mediaKey, row.mediaUploadId, partSizes(row.mediaSize)) }
      },
      { auth: true },
    )
    .post(
      "/reports/:id/finalize",
      async ({ user, params }) => {
        await requireReportMember(db, user.id, params.id)
        const [row] = await db.select().from(report).where(eq(report.id, params.id)).limit(1)
        if (!row) throw notFound("report_not_found", "Report not found")
        if (row.reporterId !== user.id) throw forbidden("Only the reporter can finalize this upload")
        // A failed upload only comes from a size mismatch below or in joinMediaParts; answer a retry the same way.
        if (row.uploadStatus === "failed") {
          throw unprocessable("upload_size_mismatch", row.uploadError ?? "Uploaded file size did not match")
        }
        if (row.uploadStatus === "ready") return { id: row.id, uploadStatus: "ready" as const, ...linksFor(row) }

        if (row.mediaUploadId) await joinMediaParts(row)

        const expected = [{ key: row.mediaKey, size: row.mediaSize }]
        if (row.debuggerKey && row.debuggerSize) expected.push({ key: row.debuggerKey, size: row.debuggerSize })

        for (const file of expected) {
          const info = await storage.head(file.key)
          if (!info) {
            throw conflict("upload_incomplete", "Upload has not finished yet; retry the upload, then finalize again")
          }
          if (info.size !== file.size) {
            await failUpload(row, `Uploaded file is ${info.size} bytes but ${file.size} bytes were declared`)
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
        const madeReady = await db.transaction(async (tx) => {
          // Locks the workspace row as an upload does, so finalizes and new uploads take turns at the count.
          await tx.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, row.workspaceId)).for("update")
          await assertCanCreateReport(
            tx,
            config,
            row.workspaceId,
            row.captureType,
            row.durationMs,
            row.id,
          )
          const updated = await tx
            .update(report)
            .set({
              uploadStatus: "ready",
              uploadError: null,
              ...(keepThumbnail ? {} : { thumbnailKey: null, thumbnailSize: null }),
            })
            // Only from uploading: of two finalizes at the same time, one makes the report ready.
            .where(and(eq(report.id, row.id), eq(report.uploadStatus, "uploading")))
            .returning({ id: report.id })
          return updated.length > 0
        })
        if (!madeReady) {
          // The other finalize got there first; it also sends the notifications, so they go out once.
          const [now] = await db.select({ uploadStatus: report.uploadStatus, uploadError: report.uploadError }).from(report).where(eq(report.id, row.id))
          if (!now) throw notFound("report_not_found", "Report not found")
          if (now.uploadStatus !== "ready") {
            throw unprocessable("upload_size_mismatch", now.uploadError ?? "Uploaded file size did not match")
          }
          return { id: row.id, uploadStatus: "ready" as const, ...linksFor(row) }
        }
        // In the background: a slow tracker must not delay the extension.
        afterFinalize(deps, row.id, async () => {
          // Side by side and each on its own: a slow or failing tracker must not keep the channels waiting.
          await Promise.all([
            dispatcher.autoSend(row.id).catch((error) => console.error("auto-send failed", { reportId: row.id, error })),
            notifyNewReport(deps, row.id).catch((error) => console.error("notify failed", { reportId: row.id, error })),
          ])
        })
        return { id: row.id, uploadStatus: "ready" as const, ...linksFor(row) }
      },
      { auth: true },
    )
}
