import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import { createProject, createUserWithToken, putUpload, setupTestApp, uploadBody } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  member = await createUserWithToken(ctx.db)
  projectId = (await createProject(ctx.db)).id
})

async function startUpload(overrides: Parameters<typeof uploadBody>[1] = {}) {
  const { data, error } = await ctx.api.api.reports.uploads.post(uploadBody(projectId, overrides), { headers: member.headers })
  if (!data) throw new Error(`upload session failed: ${JSON.stringify(error?.value)}`)
  return data
}

async function statusOf(id: string) {
  const [row] = await ctx.db.select({ uploadStatus: report.uploadStatus }).from(report).where(eq(report.id, id))
  return row?.uploadStatus
}

describe("POST /api/reports/uploads", () => {
  test("creates an uploading report with upload targets", async () => {
    const session = await startUpload({ debuggerSize: 2 })
    expect(session.mediaUpload.url).toContain("/api/uploads/local/")
    expect(session.mediaUpload.headers).toEqual({ "content-type": "image/png" })
    expect(session.debuggerUpload?.headers).toEqual({ "content-type": "application/gzip" })
    expect(session.shareUrl).toMatch(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9]{12}$/)
    expect(session.reportUrl).toBe(`http://localhost:3000/app/r/${session.reportId}`)
    expect(await statusOf(session.reportId)).toBe("uploading")
  })

  test("a report sent without a title is named after its kind and its reporter", async () => {
    const titleOf = async (id: string) => (await ctx.db.select({ title: report.title }).from(report).where(eq(report.id, id)))[0]?.title
    const name = member.user.name
    expect(await titleOf((await startUpload({ title: undefined })).reportId)).toBe(`Bugshoot by ${name}`)
    expect(await titleOf((await startUpload({ title: "   " })).reportId)).toBe(`Bugshoot by ${name}`)
    expect(await titleOf((await startUpload({ title: "", captureType: "video", durationMs: 5000 })).reportId)).toBe(`Bugcord by ${name}`)
    expect(await titleOf((await startUpload({ title: "  Pay fails " })).reportId)).toBe("Pay fails")
  })

  test("omits the debugger target when there is no payload", async () => {
    expect((await startUpload()).debuggerUpload).toBeNull()
  })

  test("enforces size, duration and project rules", async () => {
    const post = (overrides: Parameters<typeof uploadBody>[1], id = projectId) =>
      ctx.api.api.reports.uploads.post(uploadBody(id, overrides), { headers: member.headers })
    expect((await post({ mediaSize: ctx.config.maxUploadBytes + 1 })).error?.status as number | undefined).toBe(413)
    expect((await post({ debuggerSize: ctx.config.maxUploadBytes + 1 })).error?.status as number | undefined).toBe(413)
    expect((await post({ captureType: "video" })).error?.value).toMatchObject({ code: "duration_required" })
    expect((await post({}, "missing")).error?.value).toMatchObject({ code: "project_not_found" })
  })

  test("creates a report without a project when none is given", async () => {
    for (const body of [uploadBody(null), uploadBody(null, { projectId: null })]) {
      const { data } = await ctx.api.api.reports.uploads.post(body, { headers: member.headers })
      if (!data) throw new Error("expected an upload session")
      const [row] = await ctx.db.select({ projectId: report.projectId }).from(report).where(eq(report.id, data.reportId))
      expect(row?.projectId).toBeNull()
    }
  })

  test("offers a thumbnail target only when a thumbnail size is declared", async () => {
    expect((await startUpload()).thumbnailUpload).toBeNull()
    const session = await startUpload({ thumbnailSize: 3 })
    expect(session.thumbnailUpload?.headers).toEqual({ "content-type": "image/jpeg" })
    const { error } = await ctx.api.api.reports.uploads.post(uploadBody(projectId, { thumbnailSize: 1024 * 1024 + 1 }), {
      headers: member.headers,
    })
    expect(error?.status as number | undefined).toBe(422)
  })

  test("a missing capture type is rejected instead of defaulting", async () => {
    const { captureType: _omitted, ...withoutCaptureType } = uploadBody(projectId)
    const response = await ctx.app.handle(
      new Request("http://localhost/api/reports/uploads", {
        method: "POST",
        headers: { ...member.headers, "content-type": "application/json" },
        body: JSON.stringify(withoutCaptureType),
      }),
    )
    expect(response.status).toBe(422)
  })

  test("limits each user to 30 upload sessions per minute", async () => {
    for (let i = 0; i < 30; i++) await startUpload()
    const { error } = await ctx.api.api.reports.uploads.post(uploadBody(projectId), { headers: member.headers })
    expect(error?.status as number | undefined).toBe(429)
  })
})

describe("POST /api/reports/:id/finalize", () => {
  test("marks the report ready once all files are uploaded", async () => {
    const session = await startUpload({ debuggerSize: 2 })
    expect((await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))).status).toBe(200)
    if (!session.debuggerUpload) throw new Error("expected debugger upload")
    expect((await putUpload(ctx.app, session.debuggerUpload, new Uint8Array([5, 6]))).status).toBe(200)

    const { data } = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    expect(data).toEqual({ id: session.reportId, uploadStatus: "ready", reportUrl: session.reportUrl, shareUrl: session.shareUrl })
    expect(await statusOf(session.reportId)).toBe("ready")
  })

  test("finalize keeps an uploaded thumbnail", async () => {
    const session = await startUpload({ thumbnailSize: 3 })
    await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))
    if (!session.thumbnailUpload) throw new Error("expected thumbnail upload")
    await putUpload(ctx.app, session.thumbnailUpload, new Uint8Array([7, 8, 9]))
    await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    const [row] = await ctx.db.select().from(report).where(eq(report.id, session.reportId))
    expect([row?.uploadStatus, row?.thumbnailKey]).toEqual(["ready", `reports/${session.reportId}/thumbnail.jpg`])
  })

  test("finalize ignores a thumbnail that never arrived", async () => {
    const session = await startUpload({ thumbnailSize: 3 })
    await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))
    const { data } = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    expect(data?.uploadStatus).toBe("ready")
    const [row] = await ctx.db.select().from(report).where(eq(report.id, session.reportId))
    expect([row?.thumbnailKey, row?.thumbnailSize]).toEqual([null, null])
  })

  test("finalize drops a thumbnail whose size does not match", async () => {
    const session = await startUpload({ thumbnailSize: 3 })
    await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))
    if (!session.thumbnailUpload) throw new Error("expected thumbnail upload")
    await putUpload(ctx.app, session.thumbnailUpload, new Uint8Array([7, 8]))
    const { data } = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    expect(data?.uploadStatus).toBe("ready")
    const [row] = await ctx.db.select().from(report).where(eq(report.id, session.reportId))
    expect(row?.thumbnailKey).toBeNull()
    expect(await ctx.storage.head(`reports/${session.reportId}/thumbnail.jpg`)).toBeNull()
    expect(await ctx.storage.head(`reports/${session.reportId}/media.png`)).toEqual({ size: 4 })
  })

  test("finalize survives a storage error while checking the thumbnail", async () => {
    const session = await startUpload({ thumbnailSize: 3 })
    await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))
    const head = ctx.storage.head.bind(ctx.storage)
    ctx.storage.head = async (key) => {
      if (key.endsWith("thumbnail.jpg")) throw new Error("S3 hiccup")
      return head(key)
    }
    const { data } = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    expect(data?.uploadStatus).toBe("ready")
    const [row] = await ctx.db.select().from(report).where(eq(report.id, session.reportId))
    expect(row?.thumbnailKey).toBeNull()
  })

  test("is idempotent when retried", async () => {
    const session = await startUpload()
    await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))
    const finalize = () => ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    const first = await finalize()
    const second = await finalize()
    expect(second.data).toEqual(first.data)
  })

  test("asks the client to retry when a file is missing", async () => {
    const session = await startUpload()
    const { error } = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    expect(error?.status as number | undefined).toBe(409)
    expect(error?.value).toMatchObject({ code: "upload_incomplete" })
    expect(await statusOf(session.reportId)).toBe("uploading")
  })

  test("fails the report and removes files when the size does not match", async () => {
    const session = await startUpload({ mediaSize: 4 })
    await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2]))
    const { error } = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    expect(error?.status as number | undefined).toBe(422)
    expect(error?.value).toMatchObject({ code: "upload_size_mismatch" })
    expect(await statusOf(session.reportId)).toBe("failed")
    const [row] = await ctx.db.select({ mediaKey: report.mediaKey }).from(report).where(eq(report.id, session.reportId))
    expect(await ctx.storage.head(row?.mediaKey ?? "")).toBeNull()

    // Finalizing again gives the same answer as the first time, not a different status and code.
    const retry = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    expect(retry.error?.status as number | undefined).toBe(422)
    expect(retry.error?.value).toEqual(error?.value)
  })

  test("only the reporter can finalize", async () => {
    const session = await startUpload()
    const other = await createUserWithToken(ctx.db)
    const { error } = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: other.headers })
    expect(error?.status as number | undefined).toBe(403)
  })

  test("unknown reports return 404", async () => {
    const { error } = await ctx.api.api.reports({ id: "missing" }).finalize.post(undefined, { headers: member.headers })
    expect(error?.status as number | undefined).toBe(404)
  })
})
