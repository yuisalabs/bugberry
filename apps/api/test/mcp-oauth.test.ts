import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { comment, oauthConsent } from "../src/db/schema"
import { createReadyReport, createUser, sessionHeaders, setupTestApp } from "./helpers"
import { callTool, grantOAuth, mcpClient, refreshOAuth } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUser>>
let reportId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUser(ctx.db, { name: "Ana" })
  reportId = (await createReadyReport(ctx.db, { reporterId: ana.id, title: "Pay fails" })).id
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const CHALLENGE = 'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"'

const postMcp = (token: string) =>
  ctx.app.handle(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...bearer(token) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  )

describe("OAuth on the MCP server", () => {
  test("an OAuth access token works on /api/mcp and records the client name", async () => {
    const grant = await grantOAuth(ctx, ana.id, { clientName: "Claude Code" })
    const client = await mcpClient(ctx.app, bearer(grant.accessToken))
    expect((await callTool(client, "getReport", { report: reportId })).text).toContain("Pay fails")
    await callTool(client, "addComment", { report: reportId, body: "Root cause found" })
    const [row] = await ctx.db.select().from(comment).where(eq(comment.reportId, reportId))
    expect(row?.viaAgent).toBe("Claude Code")
  })

  test("a self-chosen app name is cleaned before it is stored on comments", async () => {
    const grant = await grantOAuth(ctx, ana.id, { clientName: `Claude\r\nBcc: x@evil ${"A".repeat(100)}` })
    const client = await mcpClient(ctx.app, bearer(grant.accessToken))
    await callTool(client, "addComment", { report: reportId, body: "hi" })
    const [row] = await ctx.db.select().from(comment).where(eq(comment.reportId, reportId))
    expect(row?.viaAgent).toStartWith("Claude Bcc: x@evil AAA")
    expect(row?.viaAgent?.length).toBe(60)
    expect(row?.viaAgent).not.toContain("\n")
  })

  test("a read-only grant cannot use write tools", async () => {
    const grant = await grantOAuth(ctx, ana.id, { scopes: ["openid", "bugberry:read"] })
    const client = await mcpClient(ctx.app, bearer(grant.accessToken))
    expect((await callTool(client, "getReport", { report: reportId })).isError).toBe(false)
    expect(await callTool(client, "addComment", { report: reportId, body: "x" })).toMatchObject({
      isError: true,
      text: "This connection can only read. Reconnect BugBerry and allow changes to use this tool.",
    })
  })

  test("narrowing an app's consent narrows tokens it already holds", async () => {
    const grant = await grantOAuth(ctx, ana.id)
    await ctx.db.update(oauthConsent).set({ scopes: ["openid", "bugberry:read"] }).where(eq(oauthConsent.userId, ana.id))
    const client = await mcpClient(ctx.app, bearer(grant.accessToken))
    expect((await callTool(client, "getReport", { report: reportId })).isError).toBe(false)
    expect(await callTool(client, "addComment", { report: reportId, body: "x" })).toMatchObject({
      isError: true,
      text: "This connection can only read. Reconnect BugBerry and allow changes to use this tool.",
    })
  })

  test("OAuth tokens are refused on REST routes", async () => {
    const grant = await grantOAuth(ctx, ana.id)
    const response = await ctx.app.handle(new Request("http://localhost/api/reports", { headers: bearer(grant.accessToken) }))
    expect(response.status).toBe(401)
  })

  test("tokens for another audience, forged or past exp get the 401 challenge", async () => {
    const grant = await grantOAuth(ctx, ana.id)
    const [header, payload, signature] = grant.accessToken.split(".")
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString())
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...claims, aud: "http://localhost:3000/other" })).toString("base64url")}.${signature}`
    for (const token of [forged, "not-a-jwt", `${grant.accessToken}x`]) {
      const response = await postMcp(token)
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe(CHALLENGE)
    }

    const realNow = Date.now
    Date.now = () => realNow() + 2 * 60 * 60 * 1000
    try {
      expect((await postMcp(grant.accessToken)).status).toBe(401)
    } finally {
      Date.now = realNow
    }
    expect((await postMcp(grant.accessToken)).status).toBe(200)
  })

  test("a validly signed token for another audience is refused because of its audience", async () => {
    const grant = await grantOAuth(ctx, ana.id)
    const claims = JSON.parse(Buffer.from(grant.accessToken.split(".")[1] ?? "", "base64url").toString())
    const sign = async (aud: string) =>
      (await ctx.betterAuth.api.signJWT({ body: { payload: { ...claims, aud } } })).token
    // Control: the same claims signed the same way are accepted when the audience is the MCP server.
    expect((await postMcp(await sign("http://localhost:3000/api/mcp"))).status).toBe(200)
    for (const aud of ["http://localhost:3000/other", "http://localhost:3000/api/auth/oauth2/userinfo"]) {
      const response = await postMcp(await sign(aud))
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe(CHALLENGE)
    }
  })

  test("disconnecting the app stops the access token and its refresh token", async () => {
    const grant = await grantOAuth(ctx, ana.id)
    expect((await postMcp(grant.accessToken)).status).toBe(200)
    const cookie = await sessionHeaders(ctx, ana.id)
    const removed = await ctx.api.api.me["oauth-apps"]({ clientId: grant.clientId }).delete(undefined, {
      headers: { ...cookie, origin: "http://localhost:3000" },
    })
    expect(removed.data).toEqual({ ok: true })
    expect((await postMcp(grant.accessToken)).status).toBe(401)
    expect((await refreshOAuth(ctx, grant)).status).not.toBe(200)
  })

  test("disallowed email domains are refused", async () => {
    const outsider = await createUser(ctx.db, { email: "eve@elsewhere.test" })
    const grant = await grantOAuth(ctx, outsider.id).catch(() => null)
    // Sign-in already refuses such people; a token minted before the domain list changed is refused here.
    expect(grant).not.toBeNull()
    if (grant) expect((await postMcp(grant.accessToken)).status).toBe(403)
  })
})
