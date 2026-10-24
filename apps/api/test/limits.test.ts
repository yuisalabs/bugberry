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
  workspaceLimits,
} from "../src/workspaces/limits"
import { createReadyReport, createUser, createWorkspaceRow, setupTestApp } from "./helpers"

const LIMITS = { screenshots: 5, recordings: 5, ownedWorkspaces: 1, recordingMs: 120_000 }
const TTL = 3600
const ON = { accountLimits: LIMITS, uploadUrlTtlSeconds: TTL }

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
      maxRecordingMs: 120_000,
    })
  })
})

describe("recording length", () => {
  test("a recording up to the limit and its 2 s of slack passes; longer is refused", async () => {
    await assertCanCreateReport(ctx.db, ON, workspaceId, "video", 122_000)
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "video", 122_001)).rejects.toMatchObject({
      status: 403,
      code: "duration_limit_reached",
      message: "This recording is 2:02; this workspace takes recordings up to 2:00. Trim it or record a shorter one.",
    })
  })

  test("screenshots have no length to check", async () => {
    await assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", null)
  })

  test("an unlimited owner's workspace takes recordings of any length", async () => {
    await makeUnlimited(owner.id)
    await assertCanCreateReport(ctx.db, ON, workspaceId, "video", 600_000)
  })
})

describe("assertCanCreateReport", () => {
  test("allows the 5th and refuses the 6th screenshot", async () => {
    await screenshots(4)
    await assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", null)
    await screenshots(1)
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", null)).rejects.toMatchObject({
      status: 403,
      code: "report_limit_reached",
      message: "This workspace already has 5 screenshots, the most it can keep. Delete one in the dashboard to take a new one.",
    })
  })

  test("recordings have their own message", async () => {
    await videos(5)
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "video", 1000)).rejects.toMatchObject({
      code: "report_limit_reached",
      message: "This workspace already has 5 recordings, the most it can keep. Delete one in the dashboard to record a new one.",
    })
  })

  test("a workspace over the limit stays refused for that kind only", async () => {
    await screenshots(7)
    await expect(assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", null)).rejects.toMatchObject({ code: "report_limit_reached" })
    await assertCanCreateReport(ctx.db, ON, workspaceId, "video", 1000)
  })

  test("no limit for an unlimited owner or with limits off", async () => {
    await screenshots(5)
    await assertCanCreateReport(ctx.db, { accountLimits: null, uploadUrlTtlSeconds: TTL }, workspaceId, "screenshot", null)
    await makeUnlimited(owner.id)
    await assertCanCreateReport(ctx.db, ON, workspaceId, "screenshot", null)
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
