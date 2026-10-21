import { beforeEach, describe, expect, test } from "bun:test"
import { THUMBNAIL_MAX_WIDTH } from "@bugberry/shared"
import { eq } from "drizzle-orm"
import { backfillThumbnails } from "../src/admin/backfill-thumbnails"
import { report } from "../src/db/schema"
import { LocalStorageDriver } from "../src/storage/local"
import { createReadyReport, createUser, setupTestApp } from "./helpers"

// A 4×4 PNG; tests scale it up to the size of a real screenshot.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAT0lEQVR4nAFEALv/AxABCAonFxQhQYsylQsGDPoCHAIKFZIUT5Je8UMw9djx6AQUFhcgLUg8OQ3qCAVKBDAxBNvx59rQ597GC+bzDr7gzsmMpxmHmo0ygQAAAABJRU5ErkJggg==",
  "base64",
)
const screenshotPng = (width: number, height: number) => new Bun.Image(TINY_PNG).resize(width, height).png().bytes()

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let storage: LocalStorageDriver

beforeEach(async () => {
  ctx = await setupTestApp()
  if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
  storage = ctx.storage
})

async function screenshotReport(image: Uint8Array | null, input: Partial<typeof report.$inferInsert> = {}) {
  const reporter = await createUser(ctx.db)
  const row = await createReadyReport(ctx.db, { reporterId: reporter.id, ...input })
  if (image) await storage.writeObject(row.mediaKey, new Uint8Array(image))
  return row
}

const rowOf = async (id: string) => (await ctx.db.select().from(report).where(eq(report.id, id)))[0]
const quiet = () => {}

describe("backfillThumbnails", () => {
  test("a dry run lists screenshots without a preview and changes nothing", async () => {
    const row = await screenshotReport(await screenshotPng(2880, 1800))

    const summary = await backfillThumbnails(ctx, { apply: false, log: quiet })

    expect(summary).toMatchObject({ checked: 1, created: 0 })
    expect((await rowOf(row.id))?.thumbnailKey).toBeNull()
  })

  test("--apply stores a small JPEG preview, and a second run finds nothing left", async () => {
    const row = await screenshotReport(await screenshotPng(2880, 1800))

    const summary = await backfillThumbnails(ctx, { apply: true, log: quiet })

    expect(summary).toMatchObject({ checked: 1, created: 1, failed: 0 })
    const updated = await rowOf(row.id)
    expect(updated?.thumbnailKey).toBe(`reports/${row.id}/thumbnail.jpg`)
    const file = await storage.read(updated?.thumbnailKey ?? "")
    const bytes = new Uint8Array(await (file as Blob).arrayBuffer())
    expect(bytes.byteLength).toBe(updated?.thumbnailSize ?? -1)
    expect(await new Bun.Image(bytes).metadata()).toEqual({ width: THUMBNAIL_MAX_WIDTH, height: 400, format: "jpeg" })
    expect(await backfillThumbnails(ctx, { apply: true, log: quiet })).toMatchObject({ checked: 0 })
  })

  test("never scales a small screenshot up", async () => {
    const row = await screenshotReport(await screenshotPng(320, 200))

    await backfillThumbnails(ctx, { apply: true, log: quiet })

    const file = await storage.read((await rowOf(row.id))?.thumbnailKey ?? "")
    const bytes = new Uint8Array(await (file as Blob).arrayBuffer())
    expect(await new Bun.Image(bytes).metadata()).toMatchObject({ width: 320, height: 200 })
  })

  test("leaves videos, unfinished uploads and screenshots that have a preview alone", async () => {
    const png = await screenshotPng(1280, 800)
    await screenshotReport(png, { captureType: "video", mediaType: "video/webm" })
    await screenshotReport(png, { uploadStatus: "uploading" })
    await screenshotReport(png, { thumbnailKey: "reports/x/thumbnail.jpg", thumbnailSize: 10 })

    expect(await backfillThumbnails(ctx, { apply: true, log: quiet })).toMatchObject({ checked: 0 })
  })

  test("counts a missing file and an unreadable one, and still does the rest", async () => {
    await screenshotReport(null)
    await screenshotReport(new Uint8Array([1, 2, 3]))
    const good = await screenshotReport(await screenshotPng(1280, 800))

    const summary = await backfillThumbnails(ctx, { apply: true, log: quiet })

    expect(summary).toMatchObject({ checked: 3, missing: 1, failed: 1, created: 1 })
    expect((await rowOf(good.id))?.thumbnailKey).not.toBeNull()
  })
})
