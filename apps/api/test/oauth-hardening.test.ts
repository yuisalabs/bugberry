import { beforeEach, describe, expect, test } from "bun:test"
import { createUser, sessionHeaders, setupTestApp } from "./helpers"
import { grantOAuth } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUser>>

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUser(ctx.db, { name: "Ana" })
})

/** Better Auth endpoints the dashboard and MCP clients never use: they stay closed. */
const CLOSED: Array<[method: string, path: string]> = [
  ["GET", "/token"],
  ["POST", "/oauth2/continue"],
  ["POST", "/oauth2/public-client-prelogin"],
  ["POST", "/oauth2/create-client"],
  ["POST", "/oauth2/update-client"],
  ["POST", "/oauth2/delete-client"],
  ["GET", "/oauth2/get-client?client_id=x"],
  ["GET", "/oauth2/get-clients"],
  ["POST", "/oauth2/client/rotate-secret"],
  ["GET", "/oauth2/get-consent?id=x"],
  ["GET", "/oauth2/get-consents"],
  ["POST", "/oauth2/update-consent"],
  ["POST", "/oauth2/delete-consent"],
  ["POST", "/admin/oauth2/create-client"],
  ["POST", "/admin/oauth2/update-client"],
  ["POST", "/admin/oauth2/resources"],
]

describe("unused OAuth endpoints", () => {
  test("answer 404 even to a signed-in person", async () => {
    const headers = { ...(await sessionHeaders(ctx, ana.id)), origin: ctx.config.appUrl, "content-type": "application/json" }
    for (const [method, path] of CLOSED) {
      const response = await ctx.app.handle(
        new Request(`http://localhost:3000/api/auth${path}`, { method, headers, ...(method === "POST" ? { body: "{}" } : {}) }),
      )
      expect(response.status, `${method} ${path}`).toBe(404)
    }
  })

  test("the flow AI apps and the consent page use still works", async () => {
    const grant = await grantOAuth(ctx, ana.id)
    expect(grant.accessToken.split(".")).toHaveLength(3)
    expect(grant.refreshToken).toBeTruthy()
  })
})
