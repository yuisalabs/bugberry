import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Elysia } from "elysia"
import type { AppDeps } from "../deps"
import { type CurrentUser, createUserResolver } from "../plugins/auth"
import { isEmailAllowed } from "../modules/auth/policy"
import { findCurrentUser } from "../modules/account/repository"
import { clientIp } from "../modules/share"
import { TOKEN_PREFIX } from "../modules/tokens/token"
import { type Bulkhead, BulkheadRejected, createBulkhead } from "../lib/bulkhead"
import { type AnyRateLimiter, createRateLimiter } from "../lib/rate-limit"
import { createSharedRateLimiter } from "../lib/shared-rate-limit"
import { createDispatcher } from "../modules/trackers/dispatch"
import { type McpCaller, type McpContext, RATE_LIMITED, SERVER_BUSY } from "./context"
import { createDebuggerCache } from "./debugger"
import { createKeyCache, verifyOAuthAccessToken } from "./oauth"
import { createRefusals, type Refusals } from "./refusals"
import { createMcpServer } from "./server"
import { trackerFactoryFor } from "../modules/trackers/default"

const CALLS_PER_MINUTE = 120
const SCREENSHOTS_PER_MINUTE = 20
const BOTH_SCOPES = new Set(["bugberry:read", "bugberry:write"] as const)
/** A busy answer asks the agent to wait 2 to 5 seconds, picked at random so they do not all return together. */
const BUSY_RETRY_AFTER_MIN_SECONDS = 2
const BUSY_RETRY_AFTER_SPREAD_SECONDS = 4

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers })

/** The MCP resource's metadata URL, which tells a client where to sign in. */
export function resourceMetadataUrl(appUrl: string): string {
  return `${appUrl}/.well-known/oauth-protected-resource/api/mcp`
}

function perMinute(appDeps: AppDeps, bucket: string, limit: number): AnyRateLimiter {
  return appDeps.config.mcp.sharedRateLimit
    ? createSharedRateLimiter(appDeps.db, { bucket, limit, windowMs: 60_000 })
    : createRateLimiter({ limit, windowMs: 60_000 })
}

/**
 * POST /mcp: a stateless Streamable HTTP endpoint. Each request gets its own server and transport,
 * answers with JSON (no SSE, so proxies and Cloudflare pass it untouched), and is closed afterwards.
 *
 * Agents can call far faster than people click, so MCP is kept to its own share of the server: its own database
 * pool (deps.mcpDb) and at most config.mcp.maxActive calls at once. Calls past that wait in a short queue, and
 * past the queue get a 503 with Retry-After, which agents retry; the dashboard never waits behind them.
 * One person's agents get only part of those places and of that queue, so they cannot shut out everyone else's.
 */
export function mcpModule(
  appDeps: AppDeps,
  options: {
    limiter?: AnyRateLimiter
    bulkhead?: Bulkhead
    refusals?: Refusals
    served?: boolean
    random?: () => number
  } = {},
) {
  const deps: AppDeps = appDeps.mcpDb ? { ...appDeps, db: appDeps.mcpDb } : appDeps
  const resolveUser = createUserResolver(deps)
  const limiter = options.limiter ?? perMinute(deps, "mcp_calls", CALLS_PER_MINUTE)
  const { maxActive, maxQueued, queueTimeoutMs, maxActivePerPerson, maxQueuedPerPerson } = deps.config.mcp
  const bulkhead =
    options.bulkhead ??
    createBulkhead({ maxActive, maxQueued, queueTimeoutMs, maxActivePerKey: maxActivePerPerson, maxQueuedPerKey: maxQueuedPerPerson })
  const refusals = options.refusals ?? createRefusals()
  const random = options.random ?? Math.random
  const cache = createDebuggerCache()
  const keyCache = createKeyCache()
  const screenshotLimiter = perMinute(deps, "mcp_screenshots", SCREENSHOTS_PER_MINUTE)
  const dispatcher = createDispatcher({ ...deps, trackers: trackerFactoryFor(deps) })

  const challenge = `Bearer resource_metadata="${resourceMetadataUrl(deps.config.appUrl)}"`
  const unauthorized = () => rpcError(401, -32001, "Unauthorized", { "www-authenticate": challenge })

  const loadUser = (id: string): Promise<CurrentUser | null> => findCurrentUser(deps.db, id)

  /**
   * Bearer only: a personal token (fdb_…, read + write) or an OAuth access token for this MCP resource
   * (its granted scopes). Dashboard cookies are not accepted, so a web page cannot call tools as a visitor.
   */
  const authenticate = async (headers: Headers, token: string): Promise<McpCaller | Response> => {
    let caller: McpCaller
    if (token.startsWith(TOKEN_PREFIX)) {
      const resolved = await resolveUser(headers)
      if (!resolved || resolved.tokenKind === null) return unauthorized()
      const { tokenKind: _kind, ...user } = resolved
      caller = { user, scopes: BOTH_SCOPES, via: { kind: "token" } }
    } else {
      const verified = await verifyOAuthAccessToken(deps, token, keyCache)
      const user = verified ? await loadUser(verified.userId) : null
      if (!verified || !user) return unauthorized()
      if (!verified.scopes.includes("bugberry:read")) {
        return rpcError(403, -32003, "This connection has no access to BugBerry data", {
          "www-authenticate": `Bearer error="insufficient_scope", scope="bugberry:read", resource_metadata="${resourceMetadataUrl(deps.config.appUrl)}"`,
        })
      }
      caller = { user, scopes: new Set(verified.scopes), via: { kind: "oauth", clientId: verified.clientId, clientName: verified.clientName } }
    }
    if (!isEmailAllowed(caller.user.email, deps.config.allowedEmailDomains)) {
      return rpcError(403, -32003, "Your email domain is no longer allowed")
    }
    return caller
  }

  const handle = async (request: Request, ip: string): Promise<Response> => {
    const authorization = request.headers.get("authorization")
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : ""
    if (!token) return unauthorized()

    // A caller refused a moment ago gets the same answer without a query: agents retry far faster than people.
    const refused = refusals.recall(token, ip)
    if (refused === 401) return unauthorized()
    if (refused === 429) return rpcError(429, -32029, RATE_LIMITED)

    const caller = await authenticate(request.headers, token)
    if (caller instanceof Response) {
      if (caller.status === 401) refusals.unauthorized(token, ip)
      return caller
    }
    if (!(await limiter.consume(caller.user.id))) {
      refusals.limited(token)
      return rpcError(429, -32029, RATE_LIMITED)
    }

    // One HTTP request is one call: a JSON-RPC batch would run up to 100 tools at once on one count.
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return rpcError(400, -32700, "Parse error")
    }
    if (Array.isArray(body)) return rpcError(400, -32600, "Batch requests are not supported")

    const ctx: McpContext = { deps, caller, cache, screenshotLimiter, dispatcher }
    try {
      return await bulkhead.run(() => serve(ctx, request, body), request.signal, caller.user.id)
    } catch (error) {
      if (!(error instanceof BulkheadRejected)) throw error
      const retryAfter = BUSY_RETRY_AFTER_MIN_SECONDS + Math.floor(random() * BUSY_RETRY_AFTER_SPREAD_SECONDS)
      return rpcError(503, -32000, SERVER_BUSY, { "retry-after": String(retryAfter) })
    }
  }

  const serve = async (ctx: McpContext, request: Request, body: unknown): Promise<Response> => {
    const server = createMcpServer(ctx)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(request, { parsedBody: body })
    } finally {
      await transport.close()
      await server.close()
    }
  }

  const notAllowed = () => rpcError(405, -32000, "Method not allowed")
  // SERVER_ROLE=app: MCP runs in its own container, and a request that reaches this one was routed wrongly.
  const elsewhere = () => rpcError(404, -32000, "MCP is served by the MCP container (SERVER_ROLE=mcp)")
  const served = options.served ?? true

  return new Elysia()
    .post("/mcp", ({ request, server }) => (served ? handle(request, clientIp(request, server, deps.config.proxyHops)) : elsewhere()), {
      parse: "none",
    })
    .get("/mcp", notAllowed)
    .delete("/mcp", notAllowed)
}
