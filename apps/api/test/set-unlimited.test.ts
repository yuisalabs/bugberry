import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { setUnlimited } from "../src/admin/set-unlimited"
import { user } from "../src/db/schema"
import { createUser, sessionHeaders, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const flagOf = async (id: string) => (await ctx.db.select({ unlimited: user.unlimited }).from(user).where(eq(user.id, id)))[0]?.unlimited

describe("setUnlimited", () => {
  test("a new user is not unlimited", async () => {
    const created = await createUser(ctx.db)
    expect(created.unlimited).toBe(false)
  })

  test("turns the flag on and off by email, ignoring case and spaces", async () => {
    const ana = await createUser(ctx.db, { email: "ana@kantor.test" })
    expect(await setUnlimited(ctx.db, " Ana@Kantor.test ", true)).toEqual({ userId: ana.id, email: "ana@kantor.test", unlimited: true })
    expect(await flagOf(ana.id)).toBe(true)
    expect(await setUnlimited(ctx.db, "ana@kantor.test", false)).toMatchObject({ unlimited: false })
    expect(await flagOf(ana.id)).toBe(false)
  })

  test("refuses an unknown email", async () => {
    await expect(setUnlimited(ctx.db, "nobody@x.test", true)).rejects.toThrow("No account with the email nobody@x.test")
  })

  test("update-user cannot set unlimited", async () => {
    const budi = await createUser(ctx.db)
    const headers = { ...(await sessionHeaders(ctx, budi.id)), origin: ctx.config.appUrl, "content-type": "application/json" }
    await ctx.app.handle(
      new Request("http://localhost/api/auth/update-user", { method: "POST", headers, body: JSON.stringify({ unlimited: true }) }),
    )
    expect(await flagOf(budi.id)).toBe(false)
  })
})
