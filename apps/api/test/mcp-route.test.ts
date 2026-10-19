import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import { apiToken } from "../src/db/schema"
import { createRateLimiter } from "../src/lib/rate-limit"
import { mcpModule } from "../src/mcp/route"
import { createUserWithToken, setupTestApp } from "./helpers"
import { mcpClient } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const post = (headers: Record<string, string> = {}) =>
  ctx.app.handle(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  )

describe("POST /api/mcp", () => {
  test("initializes and lists tools with a full token and an MCP token", async () => {
    for (const kind of ["full", "mcp"] as const) {
      const person = await createUserWithToken(ctx.db, { kind })
      const client = await mcpClient(ctx.app, person.headers)
      expect(client.getServerVersion()?.name).toBe("bugberry")
      expect(await client.ping()).toEqual({})
      await client.close()
    }
  })

  test("answers 401 with the resource metadata challenge without a token", async () => {
    const response = await post()
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"',
    )
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null })
  })

  test("rejects revoked tokens and disallowed email domains", async () => {
    const revoked = await createUserWithToken(ctx.db)
    await ctx.db.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.userId, revoked.user.id))
    expect((await post(revoked.headers)).status).toBe(401)

    const outsider = await createUserWithToken(ctx.db, { email: "eve@elsewhere.test" })
    expect((await post(outsider.headers)).status).toBe(403)
  })

  test("GET and DELETE answer 405", async () => {
    const person = await createUserWithToken(ctx.db)
    for (const method of ["GET", "DELETE"]) {
      const response = await ctx.app.handle(new Request("http://localhost/api/mcp", { method, headers: person.headers }))
      expect(response.status).toBe(405)
    }
  })

  test("rate limits a user", async () => {
    const person = await createUserWithToken(ctx.db)
    const limited = new Elysia({ prefix: "/api" }).use(mcpModule(ctx, { limiter: createRateLimiter({ limit: 3, windowMs: 60_000 }) }))
    const client = await mcpClient(limited, person.headers)
    await client.ping()
    await expect(client.ping()).rejects.toThrow("Too many requests, try again in a minute")
  })
})

describe("hostile requests", () => {
  test("JSON-RPC batches are refused, so one request is one call for the rate limit", async () => {
    const person = await createUserWithToken(ctx.db)
    const call = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "getTimeline", arguments: { report: "x" } } })
    const response = await ctx.app.handle(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...person.headers },
        body: JSON.stringify(Array.from({ length: 50 }, (_, n) => call(n + 1))),
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: -32600, message: "Batch requests are not supported" }, id: null })
  })
})
