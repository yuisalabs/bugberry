import { beforeAll, describe, expect, test } from "bun:test"
import { setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeAll(async () => {
  ctx = await setupTestApp()
})

const get = (path: string) => ctx.app.handle(new Request(`http://localhost:3000${path}`))

describe("OAuth discovery at the site root", () => {
  test("protected resource metadata names the MCP resource and the issuer", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-protected-resource"]) {
      const response = await get(path)
      expect(response.status).toBe(200)
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      const body = (await response.json()) as { resource: string; authorization_servers: string[]; scopes_supported: string[] }
      expect(body.resource).toBe("http://localhost:3000/api/mcp")
      expect(body.authorization_servers).toEqual(["http://localhost:3000/api/auth"])
      expect(body.scopes_supported).toEqual(["bugberry:read", "bugberry:write"])
    }
  })

  test("authorization server metadata lists registration, PKCE S256 and the bugberry scopes", async () => {
    for (const path of [
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration/api/auth",
      "/.well-known/openid-configuration",
    ]) {
      const response = await get(path)
      expect(response.status, path).toBe(200)
      const body = (await response.json()) as Record<string, unknown>
      expect(body.issuer).toBe("http://localhost:3000/api/auth")
      expect(body.registration_endpoint).toBe("http://localhost:3000/api/auth/oauth2/register")
      expect(body.code_challenge_methods_supported).toContain("S256")
      expect(body.scopes_supported).toEqual(expect.arrayContaining(["bugberry:read", "bugberry:write"]))
    }
  })

  test("the API still answers under /api", async () => {
    expect((await get("/api/health")).status).toBe(200)
  })
})
