import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { createAuth } from "../src/modules/auth/better-auth"
import { createStorage } from "../src/storage"
import { createUser, createWorkspaceRow, getTestDb, resetDb, sessionHeaders, testConfig } from "./helpers"
import { type FakeOidc, oidcOverride, signInThroughOidc, startFakeOidc, startOidcSignIn } from "./oidc-helpers"

let fake: FakeOidc

beforeAll(async () => {
  fake = await startFakeOidc()
})

afterAll(async () => {
  await fake.stop()
})

/** An app whose auth instance is created now, so its first discovery meets the fake in its current mode. */
async function appStartedNow() {
  const db = await getTestDb()
  await resetDb(db)
  const config = testConfig(oidcOverride(fake))
  const betterAuth = createAuth(config, db, { oidcStartupTimeoutMs: 300 })
  const app = createApp({ config, db, storage: createStorage(config), betterAuth })
  const workspace = await createWorkspaceRow(db, "Test")
  return { app, db, config, betterAuth, workspace }
}

describe("an IdP that is down when the server starts", () => {
  test("one that refuses: the server works, and sign-in works once the IdP is back", async () => {
    fake.setDiscovery("refuse")
    const ctx = await appStartedNow()
    expect((await startOidcSignIn(ctx)).status).toBe(404)
    fake.setDiscovery("ok")
    fake.setClaims({ sub: "kc-1", email: "ana@kantor.test", email_verified: true, name: "Ana" })
    expect((await signInThroughOidc(ctx)).location).toBe("/app")
  })

  test("one that never answers does not hold up signed-in requests", async () => {
    fake.setDiscovery("hang")
    const ctx = await appStartedNow()
    const budi = await createUser(ctx.db, { workspaceId: ctx.workspace.id })
    const started = Date.now()
    const headers = await sessionHeaders(ctx, budi.id)
    const me = await ctx.app.handle(new Request("http://localhost/api/me", { headers }))
    expect(me.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(3000)
    // The provider must be left retryable, not dropped.
    fake.setDiscovery("ok")
    fake.setClaims({ sub: "kc-1", email: "ana@kantor.test", email_verified: true, name: "Ana" })
    expect((await signInThroughOidc(ctx)).location).toBe("/app")
  }, 30_000)
})
