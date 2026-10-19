import { describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { type Auth, createAuth } from "../src/auth/better-auth"
import type { Config } from "../src/config"
import { createStorage } from "../src/storage"
import { getTestDb, resetDb, testConfig } from "./helpers"

/**
 * Better Auth 1.7 rate-limits by X-Forwarded-For only when it holds exactly one address; with more it
 * falls back to one shared "no-trusted-ip" bucket per path. Behind Caddy and nginx the header holds
 * two, so the API must hand Better Auth the single address its own hop counting picked.
 */
async function authSeenBy(overrides: Partial<Config>) {
  const db = await getTestDb()
  await resetDb(db)
  const config = testConfig(overrides)
  const auth = createAuth(config, db)
  const seen: Request[] = []
  const spy = { ...auth, handler: (request: Request) => (seen.push(request), auth.handler(request)) } as Auth
  const app = createApp({ config, db, storage: createStorage(config), betterAuth: spy })
  return { app, seen }
}

describe("client IP handed to Better Auth", () => {
  test("behind nginx and Caddy it is the single address Caddy appended", async () => {
    const { app, seen } = await authSeenBy({ proxyHops: 2 })
    const headers = { "x-forwarded-for": "10.0.0.1, 198.51.100.9, 172.18.0.5" }
    await app.handle(new Request("http://localhost/api/auth/get-session", { headers }))
    expect(seen[0]?.headers.get("x-forwarded-for")).toBe("198.51.100.9")
  })

  test("a POST keeps its body on the way to Better Auth", async () => {
    const { app, seen } = await authSeenBy({ proxyHops: 1 })
    const response = await app.handle(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1, 198.51.100.9" },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      }),
    )
    expect(seen[0]?.headers.get("x-forwarded-for")).toBe("198.51.100.9")
    expect(response.status).toBe(200)
    expect(((await response.json()) as { url?: string }).url).toContain("accounts.google.com")
  })

  test("without a trusted proxy, a forwarded address the client wrote never reaches Better Auth", async () => {
    const { app, seen } = await authSeenBy({ proxyHops: 0 })
    await app.handle(new Request("http://localhost/api/auth/get-session", { headers: { "x-forwarded-for": "203.0.113.5" } }))
    expect(seen[0]?.headers.get("x-forwarded-for")).not.toBe("203.0.113.5")
  })
})
