import { beforeEach, describe, expect, test } from "bun:test"
import { createKeyCache, verifyOAuthAccessToken } from "../src/mcp/oauth"
import { createUser, setupTestApp } from "./helpers"
import { grantOAuth } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

/** The app's Better Auth with getJwks counted. */
function countingAuth() {
  const counter = { reads: 0 }
  const api = new Proxy(ctx.betterAuth.api, {
    get(target, name, receiver) {
      if (name === "getJwks") {
        return (...args: unknown[]) => {
          counter.reads++
          return (target.getJwks as (...a: unknown[]) => unknown)(...args)
        }
      }
      return Reflect.get(target, name, receiver)
    },
  })
  return { counter, betterAuth: { ...ctx.betterAuth, api } as typeof ctx.betterAuth }
}

describe("signing keys for OAuth tokens", () => {
  test("are read once per minute, not on every request", async () => {
    const ana = await createUser(ctx.db)
    const grant = await grantOAuth(ctx, ana.id)
    const { counter, betterAuth } = countingAuth()
    let now = 0
    const keys = createKeyCache({ ttlMs: 60_000, now: () => now })
    const deps = { ...ctx, betterAuth }
    for (let n = 0; n < 5; n++) expect(await verifyOAuthAccessToken(deps, grant.accessToken, keys)).not.toBeNull()
    expect(await verifyOAuthAccessToken(deps, "garbage.token.here", keys)).toBeNull()
    expect(counter.reads).toBe(1)
    now = 61_000
    await verifyOAuthAccessToken(deps, grant.accessToken, keys)
    expect(counter.reads).toBe(2)
  })

  test("unknown key ids force a fresh read at most once a second", async () => {
    const { counter, betterAuth } = countingAuth()
    let now = 0
    const keys = createKeyCache({ ttlMs: 60_000, now: () => now })
    const deps = { ...ctx, betterAuth }
    const forged = (kid: string) =>
      `${Buffer.from(JSON.stringify({ alg: "EdDSA", kid })).toString("base64url")}.${Buffer.from("{}").toString("base64url")}.sig`
    for (let n = 0; n < 5; n++) await verifyOAuthAccessToken(deps, forged(`kid-${n}`), keys)
    expect(counter.reads).toBe(1)
    now = 1500
    for (let n = 0; n < 5; n++) await verifyOAuthAccessToken(deps, forged(`kid-later-${n}`), keys)
    expect(counter.reads).toBe(2)
  })

  test("a token signed with a key newer than the cache triggers one fresh read", async () => {
    const ana = await createUser(ctx.db)
    const { counter, betterAuth } = countingAuth()
    const keys = createKeyCache({ ttlMs: 60_000 })
    const deps = { ...ctx, betterAuth }
    // Cache an empty key set, as if the cache was filled before any key existed.
    keys.prime({ keys: [] })
    const grant = await grantOAuth(ctx, ana.id)
    expect(await verifyOAuthAccessToken(deps, grant.accessToken, keys)).not.toBeNull()
    expect(counter.reads).toBe(1)
  })
})
