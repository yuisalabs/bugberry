import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"

/**
 * OAuth discovery at the site root, outside /api: AS_IS paths go to Better Auth unchanged, and the bare discovery
 * paths some clients try first map onto /api/auth/.well-known/*.
 */
const AS_IS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/api/mcp",
  "/.well-known/oauth-authorization-server/api/auth",
]
const MAPPED: Record<string, string> = {
  "/.well-known/oauth-authorization-server": "/api/auth/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration": "/api/auth/.well-known/openid-configuration",
  "/.well-known/openid-configuration/api/auth": "/api/auth/.well-known/openid-configuration",
}

export function wellKnownModule({ betterAuth }: Pick<AppDeps, "betterAuth">) {
  const serve = async (request: Request, path: string) => {
    const url = new URL(request.url)
    url.pathname = path
    const response = await betterAuth.handler(new Request(url, { method: "GET", headers: request.headers }))
    // Public documents: browser-based MCP clients read them from other origins.
    const headers = new Headers(response.headers)
    headers.set("access-control-allow-origin", "*")
    return new Response(response.body, { status: response.status, headers })
  }

  const app = new Elysia({ name: "bugberry.well-known" })
  for (const path of AS_IS) app.get(path, ({ request }) => serve(request, path))
  for (const [path, target] of Object.entries(MAPPED)) app.get(path, ({ request }) => serve(request, target))
  return app
}
