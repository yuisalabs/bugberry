import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { deactivateUser, reactivateUser } from "../src/admin/deactivate-user"
import { user } from "../src/db/schema"
import type { EmailMessage } from "../src/lib/email/sender"
import { createUser, createUserWithToken, sessionHeaders, setupTestApp } from "./helpers"
import { grantOAuth, refreshOAuth } from "./mcp-helpers"
import { type FakeOidc, oidcOverride, signInThroughOidc, startFakeOidc } from "./oidc-helpers"

let fake: FakeOidc
let ctx: Awaited<ReturnType<typeof setupTestApp>>
let outbox: EmailMessage[]

beforeAll(async () => {
  fake = await startFakeOidc()
})

afterAll(async () => {
  await fake.stop()
})

beforeEach(async () => {
  outbox = []
  ctx = await setupTestApp(oidcOverride(fake), { email: { send: async (message) => void outbox.push(message) } })
})

/** Only the mark, without the clean-up deactivateUser does: these tests prove the check, not the deleted rows. */
const mark = (userId: string) => ctx.db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId))

const getMe = (headers: Record<string, string>) => ctx.app.handle(new Request("http://localhost/api/me", { headers }))

const postMcp = (token: string) =>
  ctx.app.handle(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  )

const postAuth = (path: string, body: object) =>
  ctx.app.handle(
    new Request(`http://localhost/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

async function signInWithEmailCode(email: string): Promise<Response> {
  outbox.length = 0
  await postAuth("/email-otp/send-verification-otp", { email, type: "sign-in" })
  const code = outbox[0]?.text.match(/\b(\d{6})\b/)?.[1] ?? ""
  return postAuth("/sign-in/email-otp", { email, otp: code })
}

describe("a deactivated account", () => {
  test("a session cookie made before deactivation is refused", async () => {
    const ana = await createUser(ctx.db)
    const headers = await sessionHeaders(ctx, ana.id)
    expect((await getMe(headers)).status).toBe(200)
    await mark(ana.id)
    expect((await getMe(headers)).status).toBe(401)
  })

  test("full and MCP personal tokens are refused", async () => {
    const full = await createUserWithToken(ctx.db)
    const mcp = await createUserWithToken(ctx.db, { kind: "mcp" })
    expect((await getMe(full.headers)).status).toBe(200)
    expect((await postMcp(mcp.token)).status).toBe(200)
    await mark(full.user.id)
    await mark(mcp.user.id)
    expect((await getMe(full.headers)).status).toBe(401)
    expect((await postMcp(mcp.token)).status).toBe(401)
  })

  test("an AI app's access token is refused before it expires, on the mark alone", async () => {
    const ana = await createUser(ctx.db)
    const grant = await grantOAuth(ctx, ana.id)
    expect((await postMcp(grant.accessToken)).status).toBe(200)
    await mark(ana.id)
    expect((await postMcp(grant.accessToken)).status).toBe(401)
  })

  test("after deactivate-user, an AI app's refresh token gets nothing", async () => {
    const ana = await createUser(ctx.db)
    const grant = await grantOAuth(ctx, ana.id)
    expect(grant.refreshToken).not.toBeNull()
    await deactivateUser(ctx.db, ana.email)
    expect((await postMcp(grant.accessToken)).status).toBe(401)
    expect((await refreshOAuth(ctx, grant)).ok).toBe(false)
  })

  test("an email code makes no session, and says why", async () => {
    const ana = await createUser(ctx.db, { email: "ana@kantor.test" })
    await mark(ana.id)
    const response = await signInWithEmailCode("ana@kantor.test")
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code?: string }).code).toBe("account_deactivated")
    expect(response.headers.getSetCookie().some((cookie) => /session_token=.+/.test(cookie.split(";")[0] ?? ""))).toBe(false)
  })

  test("company sign-in makes no session, and comes back with the reason", async () => {
    const ana = await createUser(ctx.db, { email: "ana@kantor.test" })
    await mark(ana.id)
    fake.setClaims({ sub: "kc-1", email: "ana@kantor.test", email_verified: true, name: "Ana" })
    const done = await signInThroughOidc(ctx)
    expect(new URL(done.location, "http://x").searchParams.get("error")).toBe("account_deactivated")
    expect(done.cookie).toBeNull()
  })

  test("after reactivating, signing in works again", async () => {
    const ana = await createUser(ctx.db, { email: "ana@kantor.test" })
    await deactivateUser(ctx.db, ana.email)
    expect((await signInWithEmailCode("ana@kantor.test")).status).toBe(403)
    await reactivateUser(ctx.db, ana.email)
    expect((await signInWithEmailCode("ana@kantor.test")).status).toBe(200)
  })
})
