import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { oauthAccessToken, oauthRefreshToken } from "../src/db/schema"
import { createUser, createUserWithToken, sessionHeaders, setupTestApp } from "./helpers"
import { grantOAuth, refreshOAuth } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUser>>

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUser(ctx.db, { name: "Ana" })
})

const session = async (userId: string) => ({ ...(await sessionHeaders(ctx, userId)), origin: ctx.config.appUrl })
const status = (result: { error: { status: unknown } | null }) => (result.error?.status as number | undefined) ?? 200

describe("/me/oauth-apps", () => {
  test("lists the apps a person allowed, with scopes", async () => {
    const grant = await grantOAuth(ctx, ana.id, { clientName: "Cursor" })
    const { data } = await ctx.api.api.me["oauth-apps"].get({ headers: await session(ana.id) })
    expect(data).toHaveLength(1)
    expect(data?.[0]).toMatchObject({ clientId: grant.clientId, name: "Cursor" })
    expect(data?.[0]?.scopes).toEqual(expect.arrayContaining(["bugberry:read", "bugberry:write"]))
    expect(data?.[0]?.lastUsedAt).not.toBeNull()
  })

  test("revoking removes the consent and every token; refresh fails afterwards", async () => {
    const grant = await grantOAuth(ctx, ana.id)
    const headers = await session(ana.id)
    const result = await ctx.api.api.me["oauth-apps"]({ clientId: grant.clientId }).delete(undefined, { headers })
    expect(result.data).toEqual({ ok: true })
    expect((await ctx.api.api.me["oauth-apps"].get({ headers })).data).toEqual([])
    expect(await ctx.db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, ana.id))).toEqual([])
    expect(await ctx.db.select().from(oauthAccessToken).where(eq(oauthAccessToken.userId, ana.id))).toEqual([])
    expect((await refreshOAuth(ctx, grant)).status).not.toBe(200)
  })

  test("another person's app answers 404", async () => {
    const budi = await createUser(ctx.db, { name: "Budi" })
    const grant = await grantOAuth(ctx, budi.id)
    const result = await ctx.api.api.me["oauth-apps"]({ clientId: grant.clientId }).delete(undefined, { headers: await session(ana.id) })
    expect(status(result)).toBe(404)
    expect(result.error?.value).toMatchObject({ code: "oauth_app_not_found" })
  })

  test("only a dashboard session may manage apps", async () => {
    const withToken = await createUserWithToken(ctx.db)
    expect(status(await ctx.api.api.me["oauth-apps"].get({ headers: withToken.headers }))).toBe(403)
  })
})
