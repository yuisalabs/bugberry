import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import type { Config } from "../src/config"
import { account, user } from "../src/db/schema"
import { createAuth } from "../src/modules/auth/better-auth"
import { createUser, setupTestApp, testConfig } from "./helpers"
import { type FakeOidc, oidcOverride, signInThroughOidc, startFakeOidc } from "./oidc-helpers"

let fake: FakeOidc
let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeAll(async () => {
  fake = await startFakeOidc()
})

afterAll(async () => {
  await fake.stop()
})

beforeEach(async () => {
  fake.setDiscovery("ok")
  fake.setTokenEndpoint("ok")
  ctx = await setupTestApp(oidcOverride(fake))
})

const accountsOf = async (email: string) =>
  (
    await ctx.db
      .select({ providerId: account.providerId })
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(eq(user.email, email))
  ).map((row) => row.providerId)

const usersWithEmailLike = async (email: string) =>
  (await ctx.db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`)).map((row) => row.id)

const allUserEmails = async () => (await ctx.db.select({ email: user.email }).from(user)).map((row) => row.email)

describe("company sign-in", () => {
  test("a new person signs in and gets an account", async () => {
    fake.setClaims({ sub: "kc-1", email: "ana@kantor.test", email_verified: true, name: "Ana" })
    const done = await signInThroughOidc(ctx)
    expect(done.location).toBe("/app")
    expect(done.cookie).not.toBeNull()
    expect(await accountsOf("ana@kantor.test")).toEqual(["oidc"])
  })

  test("the same email reaches the existing account, whatever case the IdP sends", async () => {
    const ana = await createUser(ctx.db, { email: "ana@kantor.test" })
    fake.setClaims({ sub: "kc-1", email: "Ana@Kantor.TEST", email_verified: true, name: "Ana" })
    expect((await signInThroughOidc(ctx)).location).toBe("/app")
    expect(await usersWithEmailLike("ana@kantor.test")).toEqual([ana.id])
  })

  test("a changed email at the IdP still reaches the same account, and the stored email stays", async () => {
    fake.setClaims({ sub: "kc-1", email: "ana@kantor.test", email_verified: true, name: "Ana" })
    await signInThroughOidc(ctx)
    fake.setClaims({ sub: "kc-1", email: "ana.new@kantor.test", email_verified: true, name: "Ana" })
    expect((await signInThroughOidc(ctx)).location).toBe("/app")
    expect(await allUserEmails()).toEqual(["ana@kantor.test"])
  })

  test("signing out does not send the browser to the IdP", async () => {
    fake.setClaims({ sub: "kc-1", email: "ana@kantor.test", email_verified: true, name: "Ana" })
    const { cookie } = await signInThroughOidc(ctx)
    const out = await ctx.app.handle(
      new Request("http://localhost/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: cookie ?? "", origin: ctx.config.appUrl, "content-type": "application/json" },
        body: "{}",
      }),
    )
    expect(out.status).toBe(200)
    expect(await out.text()).not.toContain(new URL(fake.issuer).host)
    expect(out.headers.get("location")).toBeNull()
  })

  test("OIDC is trusted for linking only when it is on", () => {
    const trusted = (config: Config) => createAuth(config, ctx.db).options.account?.accountLinking?.trustedProviders as string[]
    expect(trusted(testConfig())).not.toContain("oidc")
    expect(trusted(testConfig(oidcOverride(fake)))).toContain("oidc")
  })
})
