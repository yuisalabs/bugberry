import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { user, workspace } from "../src/db/schema"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

const LIMITS = { screenshots: 5, recordings: 5, ownedWorkspaces: 1, storageBytes: 250 * 1024 * 1024, fileBytes: 50 * 1024 * 1024 }

async function setup(limitsOn: boolean) {
  const ctx = await setupTestApp(limitsOn ? { accountLimits: LIMITS } : {})
  const owner = await createUserWithToken(ctx.db, { role: "admin" })
  await ctx.db.update(workspace).set({ ownerId: owner.user.id }).where(eq(workspace.id, ctx.workspace.id))
  return { ctx, owner }
}

describe("GET /workspaces/:id/limits and /me/limits", () => {
  test("limits off: not limited, may create workspaces", async () => {
    const { ctx, owner } = await setup(false)
    expect((await ctx.api.api.workspaces({ id: ctx.workspace.id }).limits.get({ headers: owner.headers })).data).toEqual({ limited: false })
    expect((await ctx.api.api.me.limits.get({ headers: owner.headers })).data).toEqual({ canCreateWorkspace: true, canAddMembers: true })
  })

  test("an ordinary owner sees usage and can't create another workspace", async () => {
    const { ctx, owner } = await setup(true)
    await createReadyReport(ctx.db, { reporterId: owner.user.id })
    await createReadyReport(ctx.db, { reporterId: owner.user.id })
    await createReadyReport(ctx.db, { reporterId: owner.user.id, captureType: "video", durationMs: 1000 })
    expect((await ctx.api.api.workspaces({ id: ctx.workspace.id }).limits.get({ headers: owner.headers })).data).toEqual({
      limited: true,
      screenshots: { used: 2, max: 5 },
      recordings: { used: 1, max: 5 },
      storage: { used: 9, max: 250 * 1024 * 1024 },
      maxFileBytes: 50 * 1024 * 1024,
    })
    expect((await ctx.api.api.me.limits.get({ headers: owner.headers })).data).toEqual({ canCreateWorkspace: false, canAddMembers: false })
  })

  test("an unlimited account's new workspaces may take members", async () => {
    const { ctx, owner } = await setup(true)
    await ctx.db.update(user).set({ unlimited: true }).where(eq(user.id, owner.user.id))
    expect((await ctx.api.api.me.limits.get({ headers: owner.headers })).data).toEqual({ canCreateWorkspace: true, canAddMembers: true })
  })

  test("only members read a workspace's usage", async () => {
    const { ctx } = await setup(true)
    const outsider = await createUserWithToken(ctx.db, { workspaceId: null })
    const result = await ctx.api.api.workspaces({ id: ctx.workspace.id }).limits.get({ headers: outsider.headers })
    expect([403, 404]).toContain(Number(result.error?.status))
  })
})
