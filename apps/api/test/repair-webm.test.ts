import { beforeEach, describe, expect, test } from "bun:test"
import { repairWebmRecordings } from "../src/admin/repair-webm"
import { LocalStorageDriver } from "../src/storage/local"
import { planWebmRepair } from "../src/storage/webm-repair"
import { createReadyReport, createUser, setupTestApp } from "./helpers"
import { chromeOriginal, damaged } from "./webm-fixtures"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let storage: LocalStorageDriver

beforeEach(async () => {
  ctx = await setupTestApp()
  if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
  storage = ctx.storage
})

async function videoReport(bytes: number[], input: { uploadStatus?: "ready" | "uploading" } = {}) {
  const reporter = await createUser(ctx.db)
  const id = crypto.randomUUID()
  const row = await createReadyReport(ctx.db, {
    id,
    reporterId: reporter.id,
    captureType: "video",
    mediaKey: `reports/${id}/media.webm`,
    mediaType: "video/webm",
    mediaSize: bytes.length,
    ...input,
  })
  await storage.writeObject(row.mediaKey, new Uint8Array(bytes))
  return row
}

const stored = async (key: string) => new Uint8Array(await ((await storage.read(key)) as Blob).arrayBuffer())
const quiet = () => {}

describe("repairWebmRecordings", () => {
  test("a dry run lists the damaged recording and leaves its file as it is", async () => {
    const row = await videoReport(damaged())

    const summary = await repairWebmRecordings(ctx, { apply: false, log: quiet })

    expect(summary).toMatchObject({ checked: 1, needsRepair: 1, repaired: 0 })
    expect([...(await stored(row.mediaKey))]).toEqual(damaged())
  })

  test("--apply repairs the file, and a second run finds nothing left to do", async () => {
    const row = await videoReport(damaged())

    const summary = await repairWebmRecordings(ctx, { apply: true, log: quiet })

    expect(summary).toMatchObject({ checked: 1, needsRepair: 1, repaired: 1, failed: 0 })
    const file = await stored(row.mediaKey)
    expect(file.length).toBe(damaged().length)
    expect(planWebmRepair(file, file.length).status).toBe("ok")
    expect(await repairWebmRecordings(ctx, { apply: true, log: quiet })).toMatchObject({ needsRepair: 0, alreadyOk: 1 })
  })

  test("leaves recordings that are fine, screenshots and unfinished uploads alone", async () => {
    const fine = await videoReport(chromeOriginal())
    await videoReport(damaged(), { uploadStatus: "uploading" })
    const reporter = await createUser(ctx.db)
    await createReadyReport(ctx.db, { reporterId: reporter.id })

    const summary = await repairWebmRecordings(ctx, { apply: true, log: quiet })

    expect(summary).toMatchObject({ checked: 1, alreadyOk: 1, needsRepair: 0 })
    expect([...(await stored(fine.mediaKey))]).toEqual(chromeOriginal())
  })

  test("counts a recording whose file is missing instead of stopping", async () => {
    const gone = await videoReport(damaged())
    await storage.delete(gone.mediaKey)
    await videoReport(damaged())

    const summary = await repairWebmRecordings(ctx, { apply: true, log: quiet })

    expect(summary).toMatchObject({ checked: 2, missing: 1, repaired: 1 })
  })

  test("finds the damage on S3, where a read file's size is NaN until it is fetched", async () => {
    await videoReport(damaged())
    const s3Like = Object.create(storage) as LocalStorageDriver
    s3Like.read = async (key) => {
      const blob = await storage.read(key)
      return blob && Object.defineProperty(blob.slice(), "size", { value: Number.NaN })
    }

    const summary = await repairWebmRecordings({ db: ctx.db, storage: s3Like }, { apply: false, log: quiet })

    expect(summary).toMatchObject({ checked: 1, needsRepair: 1, unrecognized: 0 })
  })
})
