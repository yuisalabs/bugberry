import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import { apiToken } from "../src/db/schema"
import { createApp, createMcpApp } from "../src/app"
import { createDb, type Db } from "../src/db/client"
import { createBulkhead } from "../src/lib/bulkhead"
import { createRateLimiter } from "../src/lib/rate-limit"
import { SERVER_BUSY } from "../src/mcp/context"
import { createRefusals } from "../src/mcp/refusals"
import { mcpModule } from "../src/mcp/route"
import { createReadyReport, createUserWithToken, setupTestApp, TEST_DATABASE_URL } from "./helpers"
import { mcpClient, putDebugger, samplePayload } from "./mcp-helpers"

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
    const statuses: number[] = []
    // The count starts over with each clock minute: held mid-minute, so the calls never straddle two of them.
    const realNow = Date.now
    const midMinute = Math.floor(realNow() / 60_000) * 60_000 + 30_000
    Date.now = () => midMinute
    try {
      const servers = [new Elysia({ prefix: "/api" }).use(mcpModule(shared)), new Elysia({ prefix: "/api" }).use(mcpModule(shared))]
      // Alternating between the two: 122 calls against one allowance of 120 a minute.
      for (let n = 0; n < 122; n++) statuses.push((await servers[n % 2]!.handle(listTools(person.headers))).status)
    } finally {
      Date.now = realNow
    }
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
    const app = new Elysia({ prefix: "/api" }).use(mcpModule(ctx, { bulkhead, random: () => 0 }))

    const response = await app.handle(listTools(person.headers))
    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("2")
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: -32000, message: SERVER_BUSY }, id: null })

    release()
    await busy
    expect((await app.handle(listTools(person.headers))).status).toBe(200)
  })

  test("busy answers spread their Retry-After over a few seconds, so agents do not all come back at once", async () => {
    const person = await createUserWithToken(ctx.db)
    const bulkhead = createBulkhead({ maxActive: 1, maxQueued: 0, queueTimeoutMs: 1000 })
    const busy = bulkhead.run(() => new Promise<void>(() => {}))
    void busy
    const retryAfter = async (random: number) => {
      const app = new Elysia({ prefix: "/api" }).use(mcpModule(ctx, { bulkhead, random: () => random }))
      return (await app.handle(listTools(person.headers))).headers.get("retry-after")
    }
    expect([await retryAfter(0), await retryAfter(0.5), await retryAfter(0.999)]).toEqual(["2", "4", "5"])
  })

  test("one person's agents hold only their share of the places, so another person's call still runs", async () => {
    const ana = await createUserWithToken(ctx.db)
    const budi = await createUserWithToken(ctx.db)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const bulkhead = createBulkhead({ maxActive: 2, maxQueued: 10, queueTimeoutMs: 1000, maxActivePerKey: 1, maxQueuedPerKey: 0 })
    const anasCall = bulkhead.run(() => held, undefined, ana.user.id)
    const app = new Elysia({ prefix: "/api" }).use(mcpModule(ctx, { bulkhead }))

    expect((await app.handle(listTools(ana.headers))).status).toBe(503)
    expect((await app.handle(listTools(budi.headers))).status).toBe(200)

    release()
    await anasCall
    expect((await app.handle(listTools(ana.headers))).status).toBe(200)
  })

  test("the limits per person come from the server's settings", async () => {
    const person = await createUserWithToken(ctx.db)
    const reportId = crypto.randomUUID()
    await createReadyReport(ctx.db, { id: reportId, reporterId: person.user.id, debuggerKey: await putDebugger(ctx, reportId, samplePayload()) })
    // The first call stops where it reads the report's captured data, so it is holding a place for certain.
    let reading!: () => void
    const reachedStorage = new Promise<void>((resolve) => {
      reading = resolve
    })
    let finishRead!: () => void
    const gate = new Promise<void>((resolve) => {
      finishRead = resolve
    })
    const storage = new Proxy(ctx.storage, {
      get(target, property) {
        if (property !== "read") return Reflect.get(target, property, target)
        return async (key: string) => {
          reading()
          await gate
          return target.read(key)
        }
      },
    })
    const tight = { ...ctx, storage, config: { ...ctx.config, mcp: { ...ctx.config.mcp, maxActivePerPerson: 1, maxQueuedPerPerson: 0 } } }
    const app = new Elysia({ prefix: "/api" }).use(mcpModule(tight))
    const readLogs = () =>
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...person.headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "getConsoleLogs", arguments: { report: reportId } } }),
      })

    const first = app.handle(readLogs())
    await reachedStorage
    // Eight places in all, but this person may hold one and may not wait.
    expect((await app.handle(readLogs())).status).toBe(503)
    finishRead()
    expect((await first).status).toBe(200)
  })

  test("a token that failed sign-in is refused again without asking the database", async () => {
    const { db, queries } = countingDb()
    const app = new Elysia({ prefix: "/api" }).use(mcpModule({ ...ctx, mcpDb: db }))
    const headers = { authorization: "Bearer fdb_made-up-token" }

    expect((await app.handle(listTools(headers))).status).toBe(401)
    const afterFirst = queries()
    expect(afterFirst).toBeGreaterThan(0)
    const again = await app.handle(listTools(headers))
    expect(again.status).toBe(401)
    expect(again.headers.get("www-authenticate")).toContain("resource_metadata=")
    expect(queries()).toBe(afterFirst)
  })

  test("a person past their calls a minute is refused again without asking the database", async () => {
    const person = await createUserWithToken(ctx.db)
    const { db, queries } = countingDb()
    const app = new Elysia({ prefix: "/api" }).use(
      mcpModule({ ...ctx, mcpDb: db }, { limiter: createRateLimiter({ limit: 1, windowMs: 60_000 }) }),
    )
    expect((await app.handle(listTools(person.headers))).status).toBe(200)
    expect((await app.handle(listTools(person.headers))).status).toBe(429)
    const afterRefusal = queries()
    const again = await app.handle(listTools(person.headers))
    expect(again.status).toBe(429)
    expect(await again.json()).toMatchObject({ error: { message: "Too many requests, try again in a minute" } })
    expect(queries()).toBe(afterRefusal)
  })

  test("an address that keeps sending made-up tokens is refused before the database, and others are not", async () => {
    const person = await createUserWithToken(ctx.db)
    const { db, queries } = countingDb()
    const behindProxy = { ...ctx, mcpDb: db, config: { ...ctx.config, proxyHops: 1 } }
    const app = new Elysia({ prefix: "/api" }).use(mcpModule(behindProxy, { refusals: createRefusals({ failedSignInsPerIp: 2 }) }))
    const from = (ip: string, token: string) => listTools({ authorization: `Bearer ${token}`, "x-forwarded-for": ip })

    for (const token of ["fdb_guess-1", "fdb_guess-2", "fdb_guess-3"]) {
      expect((await app.handle(from("203.0.113.9", token))).status).toBe(401)
    }
    const afterGuesses = queries()
    expect((await app.handle(from("203.0.113.9", "fdb_guess-4"))).status).toBe(429)
    expect(queries()).toBe(afterGuesses)
    expect((await app.handle(listTools({ ...person.headers, "x-forwarded-for": "198.51.100.7" }))).status).toBe(200)
  })

  test("tools query MCP's own connection pool, not the dashboard's", async () => {
    const person = await createUserWithToken(ctx.db)
    const mcpDb = createDb(TEST_DATABASE_URL, { max: 1 })
    const { db, queries } = countingDb(mcpDb)
    const app = new Elysia({ prefix: "/api" }).use(mcpModule({ ...ctx, mcpDb: db }))
    expect((await app.handle(listTools(person.headers))).status).toBe(200)
    expect(queries()).toBeGreaterThan(0)
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

/** A database that counts the queries started on it; the test's own unless another is given. */
function countingDb(target: Db = ctx.db) {
  let count = 0
  const db = new Proxy(target, {
    get(inner, property, receiver) {
      if (typeof property === "string" && ["select", "query", "insert", "update", "execute"].includes(property)) count++
      return Reflect.get(inner, property, receiver)
    },
  })
  return { db, queries: () => count }
}

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
