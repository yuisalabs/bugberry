import { beforeEach, describe, expect, test } from "bun:test"
import { createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

describe("app", () => {
  test("tells the login page which sign-in methods are on, without any secrets", async () => {
    const ctx = await setupTestApp({ github: { clientId: "gh", clientSecret: "s" }, gitlab: null, email: null })
    const response = await ctx.app.handle(new Request("http://localhost/api/auth-methods"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ github: true, gitlab: false, google: true, emailOtp: false })
  })

  test("health", async () => {
    const { data } = await ctx.api.api.health.get()
    expect(data).toEqual({ ok: true })
  })

  test("unknown routes return the error shape", async () => {
    const response = await ctx.app.handle(new Request("http://localhost/api/nope"))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "not_found" })
  })

  test("validation errors return 422", async () => {
    const { headers } = await createUserWithToken(ctx.db)
    const response = await ctx.app.handle(
      new Request("http://localhost/api/reports/uploads", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title: "" }),
      }),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: "validation" })
  })

  test("token routes are gone", async () => {
    const { headers } = await createUserWithToken(ctx.db)
    const call = (method: string, path: string, body?: unknown) =>
      ctx.app.handle(
        new Request(`http://localhost/api${path}`, {
          method,
          headers: { ...headers, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
    expect((await call("POST", "/tokens", { label: "x" })).status).toBe(404)
    expect((await call("GET", "/tokens")).status).toBe(404)
    expect((await call("POST", "/extension/connect", { extensionId: "abcdefghijklmnopabcdefghijklmnop" })).status).toBe(404)
  })

  test("CORS allows the extension origin only", async () => {
    const preflight = (origin: string) =>
      ctx.app.handle(
        new Request("http://localhost/api/me", {
          method: "OPTIONS",
          headers: { origin, "access-control-request-method": "GET" },
        }),
      )
    const allowed = await preflight("chrome-extension://testextensionid")
    expect(allowed.headers.get("access-control-allow-origin")).toBe("chrome-extension://testextensionid")
    const denied = await preflight("https://evil.test")
    expect(denied.headers.get("access-control-allow-origin")).not.toBe("https://evil.test")
  })

  test("Better Auth is mounted under /api/auth", async () => {
    const response = await ctx.app.handle(new Request("http://localhost:3000/api/auth/ok"))
    expect(response.status).toBe(200)
  })
})
