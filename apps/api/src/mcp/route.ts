import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Elysia } from "elysia"
import type { AppDeps } from "../app"
import { createUserResolver } from "../auth/plugin"
import { isEmailAllowed } from "../auth/policy"
import { createRateLimiter, type RateLimiter } from "../lib/rate-limit"
import { createDispatcher } from "../lib/trackers/dispatch"
import { createTrackerFactory } from "../lib/trackers/providers"
import { type McpCaller, type McpContext, RATE_LIMITED } from "./context"
import { createDebuggerCache } from "./debugger"
import { createMcpServer } from "./server"

const CALLS_PER_MINUTE = 120
const SCREENSHOTS_PER_MINUTE = 20
const BOTH_SCOPES = new Set(["bugberry:read", "bugberry:write"] as const)

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers })

/** The MCP resource's metadata URL, which tells a client where to sign in. */
export function resourceMetadataUrl(appUrl: string): string {
  return `${appUrl}/.well-known/oauth-protected-resource/api/mcp`
}

/**
 * POST /mcp: a stateless Streamable HTTP endpoint. Each request gets its own server and transport,
 * answers with JSON (no SSE, so proxies and Cloudflare pass it untouched), and is closed afterwards.
 */
export function mcpModule(deps: AppDeps, options: { limiter?: RateLimiter } = {}) {
  const resolveUser = createUserResolver(deps)
  const limiter = options.limiter ?? createRateLimiter({ limit: CALLS_PER_MINUTE, windowMs: 60_000 })
  const cache = createDebuggerCache()
  const screenshotLimiter = createRateLimiter({ limit: SCREENSHOTS_PER_MINUTE, windowMs: 60_000 })
  const dispatcher = createDispatcher({ ...deps, trackers: deps.trackers ?? createTrackerFactory() })

  const authenticate = async (headers: Headers): Promise<McpCaller | Response> => {
    const resolved = await resolveUser(headers)
    if (!resolved || resolved.tokenKind === null) {
      return rpcError(401, -32001, "Unauthorized", {
        "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl(deps.config.appUrl)}"`,
      })
    }
    const { tokenKind: _kind, ...user } = resolved
    if (!isEmailAllowed(user.email, deps.config.allowedEmailDomains)) {
      return rpcError(403, -32003, "Your email domain is no longer allowed")
    }
    return { user, scopes: BOTH_SCOPES, via: { kind: "token" } }
  }

  const handle = async (request: Request): Promise<Response> => {
    const caller = await authenticate(request.headers)
    if (caller instanceof Response) return caller
    if (!limiter.consume(caller.user.id)) return rpcError(429, -32029, RATE_LIMITED)

    const ctx: McpContext = { deps, caller, cache, screenshotLimiter, dispatcher }
    const server = createMcpServer(ctx)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(request)
    } finally {
      await transport.close()
      await server.close()
    }
  }

  const notAllowed = () => rpcError(405, -32000, "Method not allowed")

  return new Elysia()
    .post("/mcp", ({ request }) => handle(request), { parse: "none" })
    .get("/mcp", notAllowed)
    .delete("/mcp", notAllowed)
}
