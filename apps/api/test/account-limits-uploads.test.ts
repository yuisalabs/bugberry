import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report, user, workspace } from "../src/db/schema"
import { createReadyReport, createUserWithToken, putUpload, setupTestApp, uploadBody } from "./helpers"

const LIMITS = { screenshots: 5, recordings: 5, ownedWorkspaces: 1 }

/** An app with limits on (or off), whose test workspace is owned by the uploading admin. */
async function setup(limitsOn = true) {
  const ctx = await setupTestApp(limitsOn ? { accountLimits: LIMITS } : {})
  const owner = await createUserWithToken(ctx.db, { role: "admin" })
  await ctx.db.update(workspace).set({ ownerId: owner.user.id }).where(eq(workspace.id, ctx.workspace.id))
  const seed = async (count: number, extra: Partial<typeof report.$inferInsert> = {}) => {
    for (let i = 0; i < count; i++) await createReadyReport(ctx.db, { reporterId: owner.user.id, ...extra })
  }
  const upload = (headers = owner.headers, overrides: Parameters<typeof uploadBody>[1] = {}) =>
    ctx.api.api.reports.uploads.post(uploadBody(null, overrides), { headers })
  return { ctx, owner, seed, upload }
}

const video = { captureType: "video" as const, durationMs: 5000 }
const statusOf = (result: { error: { status: unknown } | null }) => (result.error ? Number(result.error.status) : 200)

describe("report limit on upload", () => {
  test("the 6th screenshot is refused with a message the extension shows as-is", async () => {
    const { ctx, seed, upload } = await setup()
    await seed(5)
    const [before] = await ctx.db.select({ next: workspace.nextReportNumber }).from(workspace).where(eq(workspace.id, ctx.workspace.id))
    const result = await upload()
    expect(statusOf(result)).toBe(403)
    expect(result.error?.value).toMatchObject({
      code: "report_limit_reached",
      message: "This workspace already has 5 screenshots, the most it can keep. Delete one in the dashboard to take a new one.",
    })
    expect(await ctx.db.select().from(report)).toHaveLength(5)
    const [after] = await ctx.db.select({ next: workspace.nextReportNumber }).from(workspace).where(eq(workspace.id, ctx.workspace.id))
    expect(after?.next).toBe(before?.next)
  })

  test("recordings have their own 5", async () => {
    const { seed, upload } = await setup()
    await seed(5)
    expect(statusOf(await upload(undefined, video))).toBe(200)
  })

  test("a workspace already over the limit keeps its reports and takes no more of that kind", async () => {
    const { ctx, seed, upload } = await setup()
    await seed(7)
    expect(statusOf(await upload())).toBe(403)
    expect(statusOf(await upload(undefined, video))).toBe(200)
    expect((await ctx.db.select().from(report)).filter((row) => row.captureType === "screenshot")).toHaveLength(7)
  })

  test("deleting one frees a slot", async () => {
    const { ctx, seed, upload } = await setup()
    await seed(5)
    const [first] = await ctx.db.select({ id: report.id }).from(report).limit(1)
    if (!first) throw new Error("expected a report")
    await ctx.db.delete(report).where(eq(report.id, first.id))
    expect(statusOf(await upload())).toBe(200)
  })

  test("an abandoned upload stops counting after the upload link expires", async () => {
    const { seed, upload } = await setup()
    await seed(4)
    await seed(1, { uploadStatus: "uploading", createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
    expect(statusOf(await upload())).toBe(200)
  })

  test("two uploads at once at 4 of 5: only one gets through", async () => {
    const { seed, upload } = await setup()
    await seed(4)
    const results = await Promise.all([upload(), upload()])
    expect(results.map(statusOf).sort()).toEqual([200, 403])
  })

  test("an unlimited owner's workspace takes any number, for every member", async () => {
    const { ctx, owner, seed, upload } = await setup()
    await ctx.db.update(user).set({ unlimited: true }).where(eq(user.id, owner.user.id))
    await seed(5)
    const member = await createUserWithToken(ctx.db, { role: "member" })
    expect(statusOf(await upload(member.headers))).toBe(200)
  })

  test("an upload left past its link's lifetime can't be finalized into a full workspace", async () => {
    const { ctx, owner, seed, upload } = await setup()
    await seed(4)
    const late = (await upload()).data
    if (!late) throw new Error("expected an upload session")
    expect((await putUpload(ctx.app, late.mediaUpload, new Uint8Array([1, 2, 3, 4]))).status).toBe(200)
    await ctx.db.update(report).set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }).where(eq(report.id, late.reportId))
    await seed(1)
    const result = await ctx.api.api.reports({ id: late.reportId }).finalize.post(undefined, { headers: owner.headers })
    expect(Number(result.error?.status)).toBe(403)
    expect(result.error?.value).toMatchObject({ code: "report_limit_reached" })
    const [row] = await ctx.db.select({ uploadStatus: report.uploadStatus }).from(report).where(eq(report.id, late.reportId))
    expect(row?.uploadStatus).not.toBe("ready")
  })

  test("a normal upload at 4 of 5 still finalizes", async () => {
    const { ctx, owner, seed, upload } = await setup()
    await seed(4)
    const session = (await upload()).data
    if (!session) throw new Error("expected an upload session")
    await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))
    const result = await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: owner.headers })
    expect(result.data?.uploadStatus).toBe("ready")
  })

  test("limits off: nothing changes", async () => {
    const { seed, upload } = await setup(false)
    await seed(6)
    expect(statusOf(await upload())).toBe(200)
  })
})
