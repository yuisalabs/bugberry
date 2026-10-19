import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { apiToken } from "../src/db/schema"
import { generateApiToken, hashToken } from "../src/lib/api-token"
import { newId } from "../src/lib/ids"
import { createProject, createReadyReport, createUserWithToken, sessionHeaders, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana", role: "admin" })
})

const session = async (userId: string) => ({ ...(await sessionHeaders(ctx, userId)), origin: ctx.config.appUrl })
const status = (result: { error: { status: unknown } | null }) => (result.error?.status as number | undefined) ?? 200

describe("/me/tokens", () => {
  test("creates, lists and revokes MCP tokens; the secret is shown once", async () => {
    const headers = await session(ana.user.id)
    const created = await ctx.api.api.me.tokens.post({ label: "Cursor laptop" }, { headers })
    expect(created.data?.token).toStartWith("fdb_")
    expect(created.data?.label).toBe("Cursor laptop")

    const listed = await ctx.api.api.me.tokens.get({ headers })
    expect(listed.data).toHaveLength(1)
    expect(listed.data?.[0]).toMatchObject({ id: created.data?.id, label: "Cursor laptop", lastUsedAt: null })
    expect(JSON.stringify(listed.data)).not.toContain(created.data?.token ?? "missing")

    const [row] = await ctx.db.select().from(apiToken).where(eq(apiToken.id, created.data?.id ?? ""))
    expect(row?.kind).toBe("mcp")

    expect((await ctx.api.api.me.tokens({ id: created.data?.id ?? "" }).delete(undefined, { headers })).data).toEqual({ ok: true })
    expect((await ctx.api.api.me.tokens.get({ headers })).data).toEqual([])
  })

  test("an MCP token is refused on REST routes", async () => {
    const mcp = await createUserWithToken(ctx.db, { kind: "mcp", role: "admin" })
    const project = await createProject(ctx.db)
    const report = await createReadyReport(ctx.db, { projectId: project.id, reporterId: mcp.user.id })
    const results = [
      await ctx.api.api.reports.get({ headers: mcp.headers }),
      await ctx.api.api.reports({ id: report.id }).patch({ visibility: "public" }, { headers: mcp.headers }),
      await ctx.api.api.reports({ id: report.id }).delete(undefined, { headers: mcp.headers }),
    ]
    for (const result of results) {
      expect(status(result)).toBe(403)
      expect(result.error?.value).toMatchObject({ message: "This token only works with the BugBerry MCP server" })
    }
  })

  test("an MCP token is treated as signed out on share links", async () => {
    const mcp = await createUserWithToken(ctx.db, { kind: "mcp" })
    const report = await createReadyReport(ctx.db, { reporterId: ana.user.id, visibility: "workspace" })
    const result = await ctx.api.api.share({ slug: report.shareSlug }).get({ headers: mcp.headers })
    expect(status(result)).toBe(401)
  })

  test("full tokens from the CLI keep working everywhere", async () => {
    expect(status(await ctx.api.api.reports.get({ headers: ana.headers }))).toBe(200)
  })

  test("tokens cannot be minted with a Bearer token", async () => {
    const result = await ctx.api.api.me.tokens.post({ label: "x" }, { headers: ana.headers })
    expect(status(result)).toBe(403)
  })

  test("the 26th active token is refused", async () => {
    await ctx.db.insert(apiToken).values(
      Array.from({ length: 25 }, (_, n) => ({
        id: newId(),
        userId: ana.user.id,
        tokenHash: hashToken(generateApiToken()),
        label: `t${n}`,
        kind: "mcp" as const,
      })),
    )
    const result = await ctx.api.api.me.tokens.post({ label: "one more" }, { headers: await session(ana.user.id) })
    expect(status(result)).toBe(409)
    expect(result.error?.value).toMatchObject({ code: "too_many_tokens" })
  })

  test("another user's token id answers 404 on delete", async () => {
    const budi = await createUserWithToken(ctx.db, { kind: "mcp" })
    const [budiToken] = await ctx.db.select().from(apiToken).where(eq(apiToken.userId, budi.user.id))
    const result = await ctx.api.api.me.tokens({ id: budiToken?.id ?? "" }).delete(undefined, { headers: await session(ana.user.id) })
    expect(status(result)).toBe(404)
  })
})
