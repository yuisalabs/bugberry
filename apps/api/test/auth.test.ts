import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { apiToken } from "../src/db/schema"
import { createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

describe("authentication", () => {
  test("rejects requests without credentials", async () => {
    const { error } = await ctx.api.api.me.get()
    expect(error?.status).toBe(401)
    expect(error?.value).toMatchObject({ code: "unauthorized" })
  })

  test("accepts an extension token and returns the user", async () => {
    const { user, headers } = await createUserWithToken(ctx.db, { name: "Ana", role: "admin" })
    const { data } = await ctx.api.api.me.get({ headers })
    expect(data).toEqual({ id: user.id, email: user.email, name: "Ana", image: null, lastWorkspaceId: ctx.workspace.id })
  })

  test("records when a token was last used", async () => {
    const { headers } = await createUserWithToken(ctx.db)
    await ctx.api.api.me.get({ headers })
    const [row] = await ctx.db.select().from(apiToken)
    expect(row?.lastUsedAt).toBeInstanceOf(Date)
  })

  test("rejects revoked, malformed and unknown tokens", async () => {
    const { headers } = await createUserWithToken(ctx.db)
    await ctx.db.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.label, "test"))
    expect((await ctx.api.api.me.get({ headers })).error?.status).toBe(401)
    expect((await ctx.api.api.me.get({ headers: { authorization: "Bearer nope" } })).error?.status).toBe(401)
    expect((await ctx.api.api.me.get({ headers: { authorization: "Bearer fdb_unknown" } })).error?.status).toBe(401)
  })

  test("blocks users whose domain is no longer allowed", async () => {
    const { headers } = await createUserWithToken(ctx.db, { email: "ex@old-company.test" })
    const { error } = await ctx.api.api.me.get({ headers })
    expect(error?.status).toBe(403)
  })
})
