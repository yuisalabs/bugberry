import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { issueExtensionToken } from "../src/admin/issue-token"
import { user, workspaceMember } from "../src/db/schema"
import { createUser, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

describe("issueExtensionToken", () => {
  test("creates the user when needed and returns a working token", async () => {
    const issued = await issueExtensionToken(ctx.db, ctx.config, { email: " Ana@Kantor.test ", name: "Ana" })
    expect(issued).toMatchObject({ email: "ana@kantor.test", createdUser: true })
    expect(issued.token).toStartWith("fdb_")
    const { data } = await ctx.api.api.me.get({ headers: { authorization: `Bearer ${issued.token}` } })
    expect(data).toMatchObject({ email: "ana@kantor.test", name: "Ana" })
  })

  test("reuses an existing user", async () => {
    const existing = await createUser(ctx.db, { email: "budi@kantor.test" })
    const issued = await issueExtensionToken(ctx.db, ctx.config, { email: "budi@kantor.test" })
    expect(issued).toMatchObject({ userId: existing.id, createdUser: false })
  })

  test("refuses emails outside the allowed domains", async () => {
    await expect(issueExtensionToken(ctx.db, ctx.config, { email: "x@other.test" })).rejects.toThrow(/ALLOWED_EMAIL_DOMAINS/)
  })

  test("a new user gets a workspace of their own, as admin", async () => {
    const issued = await issueExtensionToken(ctx.db, ctx.config, { email: "bot@kantor.test", name: "Bot" })
    const memberships = await ctx.db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(eq(workspaceMember.userId, issued.userId))
    expect(memberships).toEqual([{ role: "admin" }])
  })
})
