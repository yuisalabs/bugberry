import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { report } from "../../db/schema"
import { conflict, forbidden, notFound, tooManyRequests } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { createDispatcher } from "../../lib/trackers/dispatch"
import { trackerFactoryFor } from "../../lib/trackers/default"
import { PART_BYTES, partSizes } from "../../storage/multipart"
import { requireReportMember } from "../../workspaces/access"
import { createUploadBody } from "./model"
import { createReportUpload, finalizeReportUpload } from "./upload-flow"

export const UPLOAD_SESSIONS_PER_MINUTE = 30

export function reportUploadsModule(deps: AppDeps) {
  const { db, storage } = deps
  const limiter = createRateLimiter({ limit: UPLOAD_SESSIONS_PER_MINUTE, windowMs: 60_000 })
  const dispatcher = createDispatcher({ ...deps, trackers: trackerFactoryFor(deps) })

  return new Elysia()
    .use(authPlugin(deps))
    .post(
      "/reports/uploads",
      async ({ user, body }) => {
        if (!limiter.consume(user.id)) throw tooManyRequests()
        const { number: _number, ...created } = await createReportUpload(deps, user, body)
        return created
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
        const [row] = await db.select({ reporterId: report.reporterId }).from(report).where(eq(report.id, params.id)).limit(1)
        if (!row) throw notFound("report_not_found", "Report not found")
        if (row.reporterId !== user.id) throw forbidden("Only the reporter can finalize this upload")
        return finalizeReportUpload(deps, dispatcher, params.id)
      },
      { auth: true },
    )
}
