import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import { apiToken } from "../src/db/schema"
import { createApp, createMcpApp } from "../src/app"
import { createDb } from "../src/db/client"
import { createBulkhead } from "../src/lib/bulkhead"
import { createRateLimiter } from "../src/lib/rate-limit"
import { SERVER_BUSY } from "../src/mcp/context"
import { mcpModule } from "../src/mcp/route"
import { createUserWithToken, setupTestApp, TEST_DATABASE_URL } from "./helpers"
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

  test("a limit counted in Postgres holds across two MCP servers, as with two containers", async () => {
    const person = await createUserWithToken(ctx.db)
    const shared = { ...ctx, config: { ...ctx.config, mcp: { ...ctx.config.mcp, sharedRateLimit: true } } }
    const servers = [new Elysia({ prefix: "/api" }).use(mcpModule(shared)), new Elysia({ prefix: "/api" }).use(mcpModule(shared))]
    const statuses: number[] = []
    // Alternating between the two: 122 calls against one allowance of 120 a minute.
    for (let n = 0; n < 122; n++) statuses.push((await servers[n % 2]!.handle(listTools(person.headers))).status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(120)
    expect(statuses.slice(-2)).toEqual([429, 429])
  })

  test("past its share of the server, a call is answered 503 with Retry-After right away", async () => {
    const person = await createUserWithToken(ctx.db)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const bulkhead = createBulkhead({ maxActive: 1, maxQueued: 0, queueTimeoutMs: 1000 })
    const busy = bulkhead.run(() => held)
    const app = new Elysia({ prefix: "/api" }).use(mcpModule(ctx, { bulkhead }))

    const response = await app.handle(listTools(person.headers))
    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("2")
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: -32000, message: SERVER_BUSY }, id: null })

    release()
    await busy
    expect((await app.handle(listTools(person.headers))).status).toBe(200)
  })

  test("tools query MCP's own connection pool, not the dashboard's", async () => {
    const person = await createUserWithToken(ctx.db)
    const mcpDb = createDb(TEST_DATABASE_URL, { max: 1 })
    let mcpQueries = 0
    const counted = new Proxy(mcpDb, {
      get(target, property, receiver) {
        if (typeof property === "string" && ["select", "query", "insert", "update", "execute"].includes(property)) mcpQueries++
        return Reflect.get(target, property, receiver)
      },
    })
    const app = new Elysia({ prefix: "/api" }).use(mcpModule({ ...ctx, mcpDb: counted }))
    expect((await app.handle(listTools(person.headers))).status).toBe(200)
    expect(mcpQueries).toBeGreaterThan(0)
    await mcpDb.$client.close()
  })
})

describe("SERVER_ROLE", () => {
  test("an MCP container serves MCP and the health check, nothing of the dashboard", async () => {
    const person = await createUserWithToken(ctx.db)
    const app = createMcpApp({ ...ctx, config: { ...ctx.config, serverRole: "mcp" } })
    expect((await app.handle(listTools(person.headers))).status).toBe(200)
    expect((await app.handle(new Request("http://localhost/api/health"))).status).toBe(200)
    expect((await app.handle(new Request("http://localhost/api/me", { headers: person.headers }))).status).toBe(404)
  })

  test("the app process sends MCP calls away with a 404 that names the MCP container", async () => {
    const person = await createUserWithToken(ctx.db)
    const app = createApp({ ...ctx, config: { ...ctx.config, serverRole: "app" } })
    const response = await app.handle(listTools(person.headers))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { message: "MCP is served by the MCP container (SERVER_ROLE=mcp)" } })
  })
})

const listTools = (headers: Record<string, string>) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
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
