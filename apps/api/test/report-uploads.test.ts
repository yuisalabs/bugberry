import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import type { LocalStorageDriver } from "../src/storage/local"
import { PART_BYTES } from "../src/storage/multipart"
import type { MultipartCompletion, MultipartStorage } from "../src/storage/types"
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
    expect(session.mediaUpload?.url).toContain("/api/uploads/local/")
    expect(session.mediaUpload?.headers).toEqual({ "content-type": "image/png" })
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

describe("media in parts", () => {
  const MB = 1024 * 1024
  const SIZE = PART_BYTES * 2 + 5

  interface FakeMultipart extends MultipartStorage {
    started: Array<{ key: string; contentType: string; partSizes: number[] }>
    completed: Array<{ key: string; uploadId: string; partSizes: number[] }>
    aborted: string[]
    result: MultipartCompletion
    /** Holds every join until it resolves, to keep one going while another finalize arrives. */
    gate: Promise<void>
  }

  /** Stands in for S3: "completed" writes the joined object to the local storage, as S3 would. */
  function fakeMultipart(): FakeMultipart {
    const fake: FakeMultipart = {
      started: [],
      completed: [],
      aborted: [],
      result: "completed",
      gate: Promise.resolve(),
      async create(key, opts) {
        fake.started.push({ key, ...opts })
        const uploadId = `up-${fake.started.length}`
        return { uploadId, parts: fake.signParts(key, uploadId, opts.partSizes) }
      },
      signParts(key, uploadId, partSizes) {
        return partSizes.map((size, i) => ({ method: "PUT", url: `https://s3.test/${key}?partNumber=${i + 1}&uploadId=${uploadId}&size=${size}`, headers: {} }))
      },
      async complete(key, uploadId, partSizes) {
        fake.completed.push({ key, uploadId, partSizes })
        await fake.gate
        if (fake.result === "completed") {
          await (ctx.storage as LocalStorageDriver).writeObject(key, new Uint8Array(partSizes.reduce((sum, size) => sum + size, 0)))
        }
        return fake.result
      },
      async abort(_key, uploadId) {
        fake.aborted.push(uploadId)
      },
      async abortStale() {
        return 0
      },
    }
    return fake
  }

  let multipart: FakeMultipart
  let followUps: number

  beforeEach(async () => {
    followUps = 0
    ctx = await setupTestApp({ maxUploadBytes: 300 * MB }, { background: () => void followUps++ })
    member = await createUserWithToken(ctx.db)
    projectId = (await createProject(ctx.db)).id
    multipart = fakeMultipart()
    ctx.storage.multipart = multipart
  })

  const video = (overrides: Parameters<typeof uploadBody>[1] = {}) =>
    startUpload({ captureType: "video", durationMs: 5000, mediaSize: SIZE, multipart: true, ...overrides })
  const uploadIdOf = async (id: string) =>
    (await ctx.db.select({ mediaUploadId: report.mediaUploadId }).from(report).where(eq(report.id, id)))[0]?.mediaUploadId
  const finalize = (id: string) => ctx.api.api.reports({ id }).finalize.post(undefined, { headers: member.headers })

  test("a client that asks gets one link per part, and the upload id is kept on the report for finalize", async () => {
    const session = await video()
    expect(session.mediaUpload).toBeNull()
    expect(session.mediaParts?.partSize).toBe(PART_BYTES)
    expect(session.mediaParts?.parts).toHaveLength(3)
    expect(multipart.started).toEqual([
      { key: `reports/${session.reportId}/media.webm`, contentType: "video/webm", partSizes: [PART_BYTES, PART_BYTES, 5] },
    ])
    expect(await uploadIdOf(session.reportId)).toBe("up-1")
  })

  test("older clients, small files and storages without parts get one link", async () => {
    const older = await video({ multipart: undefined })
    const small = await video({ mediaSize: PART_BYTES })
    for (const session of [older, small]) {
      expect(session.mediaUpload?.url).toContain("/api/uploads/local/")
      expect(session.mediaParts).toBeNull()
      expect(await uploadIdOf(session.reportId)).toBeNull()
    }
    ctx.storage.multipart = undefined
    expect((await video()).mediaParts).toBeNull()
    expect(multipart.started).toHaveLength(0)
  })

  test("the size limit still holds for media in parts", async () => {
    const { error } = await ctx.api.api.reports.uploads.post(
      uploadBody(projectId, { captureType: "video", durationMs: 5000, mediaSize: 300 * MB + 1, multipart: true }),
      { headers: member.headers },
    )
    expect(error?.status as number | undefined).toBe(413)
    expect(multipart.started).toHaveLength(0)
  })

  test("finalize joins the parts, then checks the object like any upload", async () => {
    const session = await video()
    const { data } = await finalize(session.reportId)
    expect(data?.uploadStatus).toBe("ready")
    expect(multipart.completed).toEqual([
      { key: `reports/${session.reportId}/media.webm`, uploadId: "up-1", partSizes: [PART_BYTES, PART_BYTES, 5] },
    ])
    expect(await uploadIdOf(session.reportId)).toBeNull()

    // A retry after a lost answer doesn't join again.
    expect((await finalize(session.reportId)).data?.uploadStatus).toBe("ready")
    expect(multipart.completed).toHaveLength(1)
  })

  test("two finalizes at the same time join the parts once, and notify once", async () => {
    const session = await video()
    let release = () => {}
    multipart.gate = new Promise((resolve) => {
      release = resolve
    })
    const first = finalize(session.reportId)
    // The second arrives while the storage is still joining for the first.
    while (multipart.completed.length === 0) await Bun.sleep(5)
    const second = finalize(session.reportId)
    await Bun.sleep(50)
    release()

    const answers = await Promise.all([first, second])
    expect(answers.map((answer) => answer.data?.uploadStatus)).toEqual(["ready", "ready"])
    expect(multipart.completed).toHaveLength(1)
    expect(followUps).toBe(1)
  })

  test("finalize waits for missing parts", async () => {
    const session = await video()
    multipart.result = "incomplete"
    const { error } = await finalize(session.reportId)
    expect(error?.status as number | undefined).toBe(409)
    expect(error?.value).toMatchObject({ code: "upload_incomplete" })
    expect(await statusOf(session.reportId)).toBe("uploading")
    expect(await uploadIdOf(session.reportId)).toBe("up-1")
  })

  test("a part of the wrong size fails the report and drops the parts", async () => {
    const session = await video()
    multipart.result = "mismatch"
    const { error } = await finalize(session.reportId)
    expect(error?.status as number | undefined).toBe(422)
    expect(error?.value).toMatchObject({ code: "upload_size_mismatch" })
    expect(await statusOf(session.reportId)).toBe("failed")
    expect(multipart.aborted).toEqual(["up-1"])
    expect(await uploadIdOf(session.reportId)).toBeNull()
  })

  test("the reporter gets new links for the parts of an upload still in progress", async () => {
    const session = await video()
    const parts = () => ctx.api.api.reports({ id: session.reportId }).parts.post(undefined, { headers: member.headers })
    const { data } = await parts()
    expect(data?.partSize).toBe(PART_BYTES)
    expect(data?.parts.map((part) => part.url)).toEqual(session.mediaParts?.parts.map((part) => part.url))

    const other = await createUserWithToken(ctx.db)
    const stranger = await ctx.api.api.reports({ id: session.reportId }).parts.post(undefined, { headers: other.headers })
    expect([403, 404]).toContain(stranger.error?.status as number)

    await finalize(session.reportId)
    expect((await parts()).error?.value).toMatchObject({ code: "not_in_parts" })
    const single = await video({ multipart: undefined })
    const none = await ctx.api.api.reports({ id: single.reportId }).parts.post(undefined, { headers: member.headers })
    expect(none.error?.value).toMatchObject({ code: "not_in_parts" })
  })

  test("an upload the storage no longer knows is never failed on that alone", async () => {
    const session = await video()
    multipart.result = "gone"
    const { error } = await finalize(session.reportId)
    expect(error?.value).toMatchObject({ code: "upload_incomplete" })
    expect(await statusOf(session.reportId)).toBe("uploading")

    // Joined by a finalize whose answer was lost: the object is there, so the report is ready.
    await (ctx.storage as LocalStorageDriver).writeObject(`reports/${session.reportId}/media.webm`, new Uint8Array(SIZE))
    expect((await finalize(session.reportId)).data?.uploadStatus).toBe("ready")
  })
})
