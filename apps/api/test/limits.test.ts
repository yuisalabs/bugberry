import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report, user, workspace } from "../src/db/schema"
import {
  assertCanAddMembers,
  assertCanCreateReport,
  assertCanCreateWorkspace,
  canCreateWorkspace,
  countReports,
  isWorkspaceLimited,
  storageUsed,
  workspaceLimits,
} from "../src/workspaces/limits"
import { createReadyReport, createUser, createWorkspaceRow, setupTestApp } from "./helpers"

const LIMITS = { screenshots: 5, recordings: 5, ownedWorkspaces: 1, storageBytes: 250 * 1024 * 1024, fileBytes: 50 * 1024 * 1024 }
const TTL = 3600
const ON = { accountLimits: LIMITS, uploadUrlTtlSeconds: TTL }
const MB = 1024 * 1024
/** A report small enough that only the count can refuse it. */
const SMALL = { media: 4 }

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let owner: Awaited<ReturnType<typeof createUser>>
let workspaceId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  owner = await createUser(ctx.db, { role: "admin" })
  workspaceId = ctx.workspace.id
  await ctx.db.update(workspace).set({ ownerId: owner.id }).where(eq(workspace.id, workspaceId))
})

const makeUnlimited = (id: string, unlimited = true) => ctx.db.update(user).set({ unlimited }).where(eq(user.id, id))
const screenshots = async (count: number, extra: Partial<typeof report.$inferInsert> = {}) => {
  for (let i = 0; i < count; i++) await createReadyReport(ctx.db, { reporterId: owner.id, ...extra })
}
const videos = (count: number) => screenshots(count, { captureType: "video", durationMs: 1000 })

describe("isWorkspaceLimited", () => {
  test("never when limits are off", async () => {
    expect(await isWorkspaceLimited(ctx.db, null, workspaceId)).toBe(false)
  })

  test("follows the owner's flag, at once", async () => {
    expect(await isWorkspaceLimited(ctx.db, LIMITS, workspaceId)).toBe(true)
    await makeUnlimited(owner.id)
    expect(await isWorkspaceLimited(ctx.db, LIMITS, workspaceId)).toBe(false)
    await makeUnlimited(owner.id, false)
    expect(await isWorkspaceLimited(ctx.db, LIMITS, workspaceId)).toBe(true)
  })

  test("a workspace with no owner is limited", async () => {
    const orphan = await createWorkspaceRow(ctx.db, "Orphan")
    expect(await isWorkspaceLimited(ctx.db, LIMITS, orphan.id)).toBe(true)
  })
})

describe("countReports", () => {
  test("counts ready reports of the kind, in this workspace only", async () => {
    await screenshots(2)
    await videos(1)
    const other = await createWorkspaceRow(ctx.db, "Other")
    await createReadyReport(ctx.db, { reporterId: owner.id, workspaceId: other.id })
    expect(await countReports(ctx.db, workspaceId, "screenshot", TTL)).toBe(2)
    expect(await countReports(ctx.db, workspaceId, "video", TTL)).toBe(1)
  })

  test("failed uploads never count", async () => {
    await screenshots(1, { uploadStatus: "failed" })
    expect(await countReports(ctx.db, workspaceId, "screenshot", TTL)).toBe(0)
  })

  test("an upload in progress counts until its upload link expires", async () => {
    await screenshots(1, { uploadStatus: "uploading" })
    await screenshots(1, { uploadStatus: "uploading", createdAt: new Date(Date.now() - (TTL + 1) * 1000) })
    expect(await countReports(ctx.db, workspaceId, "screenshot", TTL)).toBe(1)
  })
})

describe("workspaceLimits", () => {
  test("not limited when limits are off", async () => {
    expect(await workspaceLimits(ctx.db, { accountLimits: null, uploadUrlTtlSeconds: TTL }, workspaceId)).toEqual({ limited: false })
  })

  test("usage and maximums for an ordinary owner", async () => {
    await screenshots(3)
    expect(await workspaceLimits(ctx.db, ON, workspaceId)).toEqual({
      limited: true,
      screenshots: { used: 3, max: 5 },
      recordings: { used: 0, max: 5 },
      storage: { used: 9, max: 250 * MB },
      maxFileBytes: 50 * MB,
    })
  })
})

describe("size limits", () => {
  test("a file over the per-file limit is refused, whatever room is left", async () => {
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "video", { media: 51 * MB })).rejects.toMatchObject({
      code: "file_limit_reached",
      message: "This recording is 51 MB; this workspace takes files up to 50 MB. Record a shorter one.",
    })
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", { media: 1 * MB, debugger: 60 * MB })).rejects.toMatchObject({
      code: "file_limit_reached",
    })
    await assertCanCreateReport(ctx.db, ON, workspaceId, "video", { media: 50 * MB })
  })

  test("the workspace's storage counts every file of the reports it keeps", async () => {
    await createReadyReport(ctx.db, { reporterId: owner.id, captureType: "video", durationMs: 1000, mediaSize: 40 * MB, debuggerSize: 1 * MB, thumbnailSize: 1 * MB })
    await createReadyReport(ctx.db, { reporterId: owner.id, captureType: "video", durationMs: 1000, mediaSize: 48 * MB, debuggerSize: 2 * MB })
    expect(await storageUsed(ctx.db, workspaceId, TTL)).toBe(92 * MB)
    // An upload whose link has expired no longer counts.
    await createReadyReport(ctx.db, { reporterId: owner.id, uploadStatus: "uploading", mediaSize: 5 * MB, createdAt: new Date(Date.now() - 2 * TTL * 1000) })
    expect(await storageUsed(ctx.db, workspaceId, TTL)).toBe(92 * MB)
  })

  test("a report that doesn't fit in the room left is refused; deleting one makes room", async () => {
    const big = { reporterId: owner.id, captureType: "video" as const, durationMs: 1000, mediaSize: 50 * MB }
    const kept = []
    for (let i = 0; i < 4; i++) kept.push(await createReadyReport(ctx.db, big))
    // 200 MB used, 50 MB left.
    await assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", { media: 50 * MB })
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", { media: 49 * MB, debugger: 1 * MB, thumbnail: 1 })).rejects.toMatchObject({
      code: "storage_limit_reached",
      message: "This report needs 50 MB, but this workspace has 50 MB of its 250 MB left. Delete a report in the dashboard to make room.",
    })
    await ctx.db.delete(report).where(eq(report.id, kept[0]?.id ?? ""))
    await assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", { media: 49 * MB, debugger: 1 * MB, thumbnail: 1 })
  })

  test("an unlimited owner's workspace has no size limits", async () => {
    await makeUnlimited(owner.id)
    await assertCanCreateReport(ctx.db, ON, workspaceId, "video", { media: 300 * MB })
  })
})

describe("assertCanCreateReport", () => {
  test("allows the 5th and refuses the 6th screenshot", async () => {
    await screenshots(4)
    await assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", SMALL)
    await screenshots(1)
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", SMALL)).rejects.toMatchObject({
      status: 403,
      code: "report_limit_reached",
      message: "This workspace already has 5 screenshots, the most it can keep. Delete one in the dashboard to take a new one.",
    })
  })

  test("recordings have their own message", async () => {
    await videos(5)
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "video", SMALL)).rejects.toMatchObject({
      code: "report_limit_reached",
      message: "This workspace already has 5 recordings, the most it can keep. Delete one in the dashboard to record a new one.",
    })
  })

  test("a workspace over the limit stays refused for that kind only", async () => {
    await screenshots(7)
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", SMALL)).rejects.toMatchObject({ code: "report_limit_reached" })
    await assertCanCreateReport(ctx.db, ON, workspaceId, "video", SMALL)
  })

  test("no limit for an unlimited owner or with limits off", async () => {
    await screenshots(5)
    await assertCanCreateReport(ctx.db, { accountLimits: null, uploadUrlTtlSeconds: TTL }, workspaceId, "screenshot", SMALL)
    await makeUnlimited(owner.id)
    await assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", SMALL)
  })
})

describe("creating workspaces", () => {
  test("an ordinary account owning none may create one; owning one, it may not", async () => {
    const newcomer = await createUser(ctx.db)
    expect(await canCreateWorkspace(ctx.db, LIMITS, newcomer.id)).toBe(true)
    expect(await canCreateWorkspace(ctx.db, LIMITS, owner.id)).toBe(false)
    await expect(assertCanCreateWorkspace(ctx.db, LIMITS, owner.id)).rejects.toMatchObject({
      status: 403,
      code: "workspace_limit_reached",
      message: "Your account can own 1 workspace.",
    })
  })

  test("the message counts workspaces in the plural above 1", async () => {
    await expect(assertCanCreateWorkspace(ctx.db, { ...LIMITS, ownedWorkspaces: 1 }, owner.id)).rejects.toThrow("1 workspace.")
    const two = { ...LIMITS, ownedWorkspaces: 2 }
    await ctx.db.insert(workspace).values({ id: "second", name: "Second", ownerId: owner.id })
    await expect(assertCanCreateWorkspace(ctx.db, two, owner.id)).rejects.toThrow("Your account can own 2 workspaces.")
  })

  test("being a member elsewhere doesn't count", async () => {
    const member = await createUser(ctx.db, { role: "member" })
    expect(await canCreateWorkspace(ctx.db, LIMITS, member.id)).toBe(true)
  })

  test("an unlimited account or limits off: always", async () => {
    expect(await canCreateWorkspace(ctx.db, null, owner.id)).toBe(true)
    await makeUnlimited(owner.id)
    await assertCanCreateWorkspace(ctx.db, LIMITS, owner.id)
  })
})

describe("assertCanAddMembers", () => {
  test("refused in an ordinary owner's workspace", async () => {
    await expect(assertCanAddMembers(ctx.db, LIMITS, workspaceId)).rejects.toMatchObject({
      status: 403,
      code: "members_not_allowed",
      message: "Inviting teammates isn't available on this account.",
    })
  })

  test("allowed for an unlimited owner or with limits off", async () => {
    await assertCanAddMembers(ctx.db, null, workspaceId)
    await makeUnlimited(owner.id)
    await assertCanAddMembers(ctx.db, LIMITS, workspaceId)
  })
})
