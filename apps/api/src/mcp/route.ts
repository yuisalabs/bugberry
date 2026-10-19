import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import type { AppDeps } from "../app"
import { type CurrentUser, createUserResolver } from "../auth/plugin"
import { isEmailAllowed } from "../auth/policy"
import { user as userTable } from "../db/schema"
import { TOKEN_PREFIX } from "../lib/api-token"
import { createRateLimiter, type RateLimiter } from "../lib/rate-limit"
import { createDispatcher } from "../lib/trackers/dispatch"
import { createTrackerFactory } from "../lib/trackers/providers"
import { type McpCaller, type McpContext, RATE_LIMITED } from "./context"
import { createDebuggerCache } from "./debugger"
import { verifyOAuthAccessToken } from "./oauth"
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

  const challenge = `Bearer resource_metadata="${resourceMetadataUrl(deps.config.appUrl)}"`
  const unauthorized = () => rpcError(401, -32001, "Unauthorized", { "www-authenticate": challenge })

  const loadUser = async (id: string): Promise<CurrentUser | null> => {
    const [row] = await deps.db
      .select({
        id: userTable.id,
        email: userTable.email,
        name: userTable.name,
        image: userTable.image,
        lastWorkspaceId: userTable.lastWorkspaceId,
      })
      .from(userTable)
      .where(eq(userTable.id, id))
      .limit(1)
    return row ?? null
  }

  /**
   * Bearer only: a personal token (fdb_…, read + write) or an OAuth access token for this MCP resource
   * (its granted scopes). Dashboard cookies are not accepted, so a web page cannot call tools as a visitor.
   */
  const authenticate = async (headers: Headers): Promise<McpCaller | Response> => {
    const authorization = headers.get("authorization")
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : ""
    if (!token) return unauthorized()

    let caller: McpCaller
    if (token.startsWith(TOKEN_PREFIX)) {
      const resolved = await resolveUser(headers)
      if (!resolved || resolved.tokenKind === null) return unauthorized()
      const { tokenKind: _kind, ...user } = resolved
      caller = { user, scopes: BOTH_SCOPES, via: { kind: "token" } }
    } else {
      const verified = await verifyOAuthAccessToken(deps, token)
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
