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
import { createTrackerFactory } from "../../lib/trackers/providers"
import { debuggerKeyFor, mediaKeyFor, thumbnailKeyFor } from "../../storage/keys"
import { requireReportMember, resolveWorkspace } from "../../workspaces/access"
import { assertCanCreateReport } from "../../workspaces/limits"
import { createUploadBody } from "./model"
import { afterFinalize } from "./after-finalize"
import { claimReportNumber } from "./numbers"

const UPLOAD_SESSIONS_PER_MINUTE = 30

export function reportUploadsModule(deps: AppDeps) {
  const { config, db, storage } = deps
  const limiter = createRateLimiter({ limit: UPLOAD_SESSIONS_PER_MINUTE, windowMs: 60_000 })
  const dispatcher = createDispatcher({ ...deps, trackers: deps.trackers ?? createTrackerFactory() })
  const linksFor = (row: { id: string; shareSlug: string }) => ({
    reportUrl: `${config.appUrl}/app/r/${row.id}`,
    shareUrl: `${config.appUrl}/s/${row.shareSlug}`,
  })

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

        const id = newId()
        const mediaType = MEDIA_TYPES[body.captureType]
        const mediaKey = mediaKeyFor(id, body.captureType)
        const debuggerKey = body.debuggerSize ? debuggerKeyFor(id) : null
        const thumbnailKey = body.thumbnailSize ? thumbnailKeyFor(id) : null

        const created = await db.transaction(async (tx) => {
          const number = await claimReportNumber(tx, workspaceId)
          // Counted after the claim, which locks the workspace row: uploads at the same time take turns here.
          await assertCanCreateReport(tx, config, workspaceId, body.captureType)
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

        const mediaUpload = await storage.createUploadTarget(mediaKey, { contentType: mediaType, maxBytes: body.mediaSize })
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

        return { reportId: created.id, ...linksFor(created), mediaUpload, debuggerUpload, thumbnailUpload }
      },
      { auth: true, body: createUploadBody },
    )
    .post(
      "/reports/:id/finalize",
      async ({ user, params }) => {
        await requireReportMember(db, user.id, params.id)
        const [row] = await db.select().from(report).where(eq(report.id, params.id)).limit(1)
        if (!row) throw notFound("report_not_found", "Report not found")
        if (row.reporterId !== user.id) throw forbidden("Only the reporter can finalize this upload")
        // A failed upload only comes from a size mismatch below; answer a retry the same way.
        if (row.uploadStatus === "failed") {
          throw unprocessable("upload_size_mismatch", row.uploadError ?? "Uploaded file size did not match")
        }
        if (row.uploadStatus === "ready") return { id: row.id, uploadStatus: "ready" as const, ...linksFor(row) }

        const expected = [{ key: row.mediaKey, size: row.mediaSize }]
        if (row.debuggerKey && row.debuggerSize) expected.push({ key: row.debuggerKey, size: row.debuggerSize })

        for (const file of expected) {
          const info = await storage.head(file.key)
          if (!info) {
            throw conflict("upload_incomplete", "Upload has not finished yet; retry the upload, then finalize again")
          }
          if (info.size !== file.size) {
            const message = `Uploaded file is ${info.size} bytes but ${file.size} bytes were declared`
            const thumbnail = row.thumbnailKey ? [storage.delete(row.thumbnailKey).catch(() => undefined)] : []
            await Promise.all([...expected.map((entry) => storage.delete(entry.key)), ...thumbnail])
            await db.update(report).set({ uploadStatus: "failed", uploadError: message }).where(eq(report.id, row.id))
            throw unprocessable("upload_size_mismatch", message)
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
        await db.transaction(async (tx) => {
          // Locks the workspace row as an upload does, so finalizes and new uploads take turns at the count.
          await tx.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, row.workspaceId)).for("update")
          await assertCanCreateReport(tx, config, row.workspaceId, row.captureType, row.id)
          await tx
            .update(report)
            .set({
              uploadStatus: "ready",
              uploadError: null,
              ...(keepThumbnail ? {} : { thumbnailKey: null, thumbnailSize: null }),
            })
            .where(eq(report.id, row.id))
        })
        // In the background: a slow tracker must not delay the extension.
        afterFinalize(deps, row.id, () => dispatcher.autoSend(row.id))
        return { id: row.id, uploadStatus: "ready" as const, ...linksFor(row) }
      },
      { auth: true },
    )
}
