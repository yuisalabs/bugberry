import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { workspace } from "../src/db/schema"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

const LIMITS = { screenshots: 5, recordings: 5, ownedWorkspaces: 1 }

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
    expect((await ctx.api.api.me.limits.get({ headers: owner.headers })).data).toEqual({ canCreateWorkspace: true })
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
    })
    expect((await ctx.api.api.me.limits.get({ headers: owner.headers })).data).toEqual({ canCreateWorkspace: false })
  })

  test("only members read a workspace's usage", async () => {
    const { ctx } = await setup(true)
    const outsider = await createUserWithToken(ctx.db, { workspaceId: null })
    const result = await ctx.api.api.workspaces({ id: ctx.workspace.id }).limits.get({ headers: outsider.headers })
    expect([403, 404]).toContain(Number(result.error?.status))
  })
})
