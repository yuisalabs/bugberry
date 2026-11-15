import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq, isNull } from "drizzle-orm"
import { deactivateUser, reactivateUser } from "../src/admin/deactivate-user"
import { apiToken, oauthAccessToken, oauthConsent, oauthRefreshToken, report, session, user, workspaceMember } from "../src/db/schema"
import { createReadyReport, createUser, createUserWithToken, sessionHeaders, setupTestApp } from "./helpers"
import { grantOAuth } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

type OwnedTable = typeof session | typeof oauthAccessToken | typeof oauthConsent | typeof oauthRefreshToken

const rowsOf = async (table: OwnedTable, userId: string) => (await ctx.db.select().from(table).where(eq(table.userId, userId))).length

const activeTokens = async (userId: string) =>
  (await ctx.db.select().from(apiToken).where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))).length

const deactivatedAtOf = async (userId: string) =>
  (await ctx.db.select({ at: user.deactivatedAt }).from(user).where(eq(user.id, userId)))[0]?.at

describe("deactivateUser", () => {
  test("ends sessions, revokes tokens and disconnects AI apps, and keeps everything else", async () => {
    const ana = await createUserWithToken(ctx.db, { email: "ana@kantor.test", role: "admin" })
    await sessionHeaders(ctx, ana.user.id)
    await grantOAuth(ctx, ana.user.id)
    const mine = await createReadyReport(ctx.db, { reporterId: ana.user.id, assigneeId: ana.user.id })
    expect(await rowsOf(session, ana.user.id)).toBeGreaterThan(0)
    expect(await rowsOf(oauthRefreshToken, ana.user.id)).toBeGreaterThan(0)
    expect(await rowsOf(oauthConsent, ana.user.id)).toBeGreaterThan(0)

    const result = await deactivateUser(ctx.db, " Ana@Kantor.test ")

    expect(result).toMatchObject({ userId: ana.user.id, email: "ana@kantor.test", alreadyDeactivated: false })
    expect(await deactivatedAtOf(ana.user.id)).toBeInstanceOf(Date)
    expect(await rowsOf(session, ana.user.id)).toBe(0)
    expect(await activeTokens(ana.user.id)).toBe(0)
    expect(await rowsOf(oauthRefreshToken, ana.user.id)).toBe(0)
    expect(await rowsOf(oauthAccessToken, ana.user.id)).toBe(0)
    expect(await rowsOf(oauthConsent, ana.user.id)).toBe(0)
    const [membership] = await ctx.db.select().from(workspaceMember).where(eq(workspaceMember.userId, ana.user.id))
    expect(membership?.role).toBe("admin")
    const [kept] = await ctx.db.select().from(report).where(eq(report.id, mine.id))
    expect(kept?.assigneeId).toBe(ana.user.id)
  })

  test("it never refuses, and lists workspaces left without an active admin", async () => {
    await createUser(ctx.db, { email: "ana@kantor.test", role: "admin" })
    await createUser(ctx.db, { role: "member" })
    expect((await deactivateUser(ctx.db, "ana@kantor.test")).withoutAdmin).toEqual([{ name: "Test", ref: ctx.workspace.slug ?? "" }])
  })

  test("a second run says so, keeps the first time, and still cleans up", async () => {
    const ana = await createUserWithToken(ctx.db, { email: "ana@kantor.test" })
    await deactivateUser(ctx.db, "ana@kantor.test")
    const first = await deactivatedAtOf(ana.user.id)
    // A session that slipped in by hand, as a leftover from a restored backup would.
    await ctx.db.insert(session).values({ id: "s1", token: "t1", userId: ana.user.id, expiresAt: new Date(Date.now() + 60_000) })
    expect(await deactivateUser(ctx.db, "ana@kantor.test")).toMatchObject({ alreadyDeactivated: true })
    expect(await deactivatedAtOf(ana.user.id)).toEqual(first)
    expect(await rowsOf(session, ana.user.id)).toBe(0)
  })

  test("a workspace with another active admin is not listed, one whose other admin is deactivated is", async () => {
    await createUser(ctx.db, { email: "ana@kantor.test", role: "admin" })
    await createUser(ctx.db, { email: "budi@kantor.test", role: "admin" })
    expect((await deactivateUser(ctx.db, "ana@kantor.test")).withoutAdmin).toEqual([])
    expect((await deactivateUser(ctx.db, "budi@kantor.test")).withoutAdmin).toHaveLength(1)
  })

  test("an unknown email is an error", async () => {
    await expect(deactivateUser(ctx.db, "nobody@x.test")).rejects.toThrow("No account with the email nobody@x.test")
  })
})

describe("reactivateUser", () => {
  test("removes the mark; revoked tokens stay revoked", async () => {
    const ana = await createUserWithToken(ctx.db, { email: "ana@kantor.test" })
    await deactivateUser(ctx.db, "ana@kantor.test")
    expect(await reactivateUser(ctx.db, " ANA@kantor.test")).toEqual({ userId: ana.user.id, email: "ana@kantor.test", wasDeactivated: true })
    expect(await deactivatedAtOf(ana.user.id)).toBeNull()
    expect(await activeTokens(ana.user.id)).toBe(0)
    expect(await reactivateUser(ctx.db, "ana@kantor.test")).toMatchObject({ wasDeactivated: false })
  })

  test("an unknown email is an error", async () => {
    await expect(reactivateUser(ctx.db, "nobody@x.test")).rejects.toThrow("No account with the email nobody@x.test")
  })
})
