import { beforeEach, describe, expect, mock, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import { cleanupStaleUploads, startCleanupSchedule } from "../src/jobs/cleanup"
import { LocalStorageDriver } from "../src/storage/local"
import { createProject, createReadyReport, createUser, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

describe("cleanupStaleUploads", () => {
  test("removes uploads stuck for longer than the cutoff, with their files", async () => {
    const reporter = await createUser(ctx.db)
    const { id: projectId } = await createProject(ctx.db)
    const hour = 60 * 60 * 1000
    const stale = await createReadyReport(ctx.db, {
      projectId,
      reporterId: reporter.id,
      title: "stale",
      uploadStatus: "uploading",
      createdAt: new Date(Date.now() - 25 * hour),
    })
    await createReadyReport(ctx.db, {
      projectId,
      reporterId: reporter.id,
      title: "recent",
      uploadStatus: "uploading",
      createdAt: new Date(Date.now() - hour),
    })
    await createReadyReport(ctx.db, {
      projectId,
      reporterId: reporter.id,
      title: "old but ready",
      createdAt: new Date(Date.now() - 48 * hour),
    })
    if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
    await ctx.storage.writeObject(stale.mediaKey, new Uint8Array([1]))
    const thumbnailKey = `reports/${stale.id}/thumbnail.jpg`
    await ctx.db.update(report).set({ thumbnailKey, thumbnailSize: 1 }).where(eq(report.id, stale.id))
    await ctx.storage.writeObject(thumbnailKey, new Uint8Array([2]))

    const removed = await cleanupStaleUploads(ctx, new Date(Date.now() - 24 * hour))

    expect(removed).toBe(1)
    expect(await ctx.storage.head(stale.mediaKey)).toBeNull()
    expect(await ctx.storage.head(thumbnailKey)).toBeNull()
    const titles = (await ctx.db.select({ title: report.title }).from(report)).map((row) => row.title).sort()
    expect(titles).toEqual(["old but ready", "recent"])
  })

  test("aborts uploads in parts started before the cutoff, and a storage error there doesn't stop the cleanup", async () => {
    const cutoffs: Date[] = []
    ctx.storage.multipart = {
      create: async () => ({ uploadId: "", parts: [] }),
      signParts: () => [],
      complete: async () => "completed",
      abort: async () => undefined,
      abortStale: async (olderThan) => {
        cutoffs.push(olderThan)
        throw new Error("S3 hiccup")
      },
    }
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    expect(await cleanupStaleUploads(ctx, cutoff)).toBe(0)
    expect(cutoffs).toEqual([cutoff])
  })

  test("also removes old failed uploads, which no list or page ever shows", async () => {
    const reporter = await createUser(ctx.db)
    const { id: projectId } = await createProject(ctx.db)
    const hour = 60 * 60 * 1000
    for (const [title, age] of [
      ["old failed", 25],
      ["recent failed", 1],
    ] as const) {
      await createReadyReport(ctx.db, {
        projectId,
        reporterId: reporter.id,
        title,
        uploadStatus: "failed",
        createdAt: new Date(Date.now() - age * hour),
      })
    }

    expect(await cleanupStaleUploads(ctx, new Date(Date.now() - 24 * hour))).toBe(1)
    const titles = (await ctx.db.select({ title: report.title }).from(report)).map((row) => row.title)
    expect(titles).toEqual(["recent failed"])
  })
})

describe("startCleanupSchedule", () => {
  test("runs once right away, then on the interval, until stopped", () => {
    const run = mock(() => {})
    let tick: () => void = () => {}
    const cleared: unknown[] = []
    const stop = startCleanupSchedule(run, 1000, {
      setInterval: (callback: () => void) => {
        tick = callback
        return "timer"
      },
      clearInterval: (timer: unknown) => cleared.push(timer),
    })
    expect(run).toHaveBeenCalledTimes(1)
    tick()
    expect(run).toHaveBeenCalledTimes(2)
    stop()
    expect(cleared).toEqual(["timer"])
  })
})
