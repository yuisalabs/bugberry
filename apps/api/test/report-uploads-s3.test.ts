import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import { PART_BYTES } from "../src/storage/multipart"
import { createProject, createUserWithToken, setupTestApp, uploadBody } from "./helpers"

const endpoint = process.env.S3_TEST_ENDPOINT

/** The whole way, against a real bucket: upload session, parts sent like the extension does, finalize. */
describe.skipIf(!endpoint)("a video in parts, against MinIO or RustFS", () => {
  test("is joined into one file and the report becomes ready", async () => {
    const ctx = await setupTestApp({
      maxUploadBytes: 64 * 1024 * 1024,
      storage: {
        driver: "s3",
        endpoint: endpoint ?? "",
        region: "us-east-1",
        bucket: process.env.S3_TEST_BUCKET ?? "",
        accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "",
        virtualHostedStyle: false,
      },
    })
    const member = await createUserWithToken(ctx.db)
    const { id: projectId } = await createProject(ctx.db)
    const video = new Uint8Array(PART_BYTES + 5).map((_, index) => index % 251)

    const { data: session } = await ctx.api.api.reports.uploads.post(
      uploadBody(projectId, { captureType: "video", durationMs: 5000, mediaSize: video.length, multipart: true }),
      { headers: member.headers },
    )
    if (!session?.mediaParts) throw new Error("expected media in parts")
    const { partSize, parts } = session.mediaParts
    expect(parts).toHaveLength(2)

    const finalize = () => ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
    const send = (index: number) =>
      fetch(parts[index]?.url ?? "", { method: "PUT", body: video.slice(index * partSize, (index + 1) * partSize) })

    expect((await send(0)).ok).toBe(true)
    expect((await finalize()).error?.value).toMatchObject({ code: "upload_incomplete" })
    expect((await send(1)).ok).toBe(true)
    expect((await finalize()).data?.uploadStatus).toBe("ready")

    const [row] = await ctx.db.select().from(report).where(eq(report.id, session.reportId))
    expect(row?.mediaUploadId).toBeNull()
    const stored = new Uint8Array(await ((await ctx.storage.read(row?.mediaKey ?? "")) as Blob).arrayBuffer())
    expect(stored.length).toBe(video.length)
    expect(Bun.hash(stored)).toBe(Bun.hash(video))
    await ctx.storage.delete(row?.mediaKey ?? "")
  })
})
