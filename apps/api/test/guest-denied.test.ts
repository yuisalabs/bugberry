import { beforeAll, describe, expect, test } from "bun:test"
import { comment } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { addGuest, createIntegration, createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient } from "./mcp-helpers"

/** Every id a route could take, for the fixture below. */
interface Ids {
  workspace: string
  p1: string
  p2: string
  reportP1: string
  reportP2: string
  reportNone: string
  commentP1: string
  label: string
  integration: string
  connection: string
  member: string
}

type Route = { route: string; path: (ids: Ids) => string; body?: (ids: Ids) => unknown }

const at = (route: string, path: (ids: Ids) => string, body?: (ids: Ids) => unknown): Route => ({ route, path, body })

/**
 * Routes that serve workspace members only. A guest of P1 must get exactly what someone in no workspace gets. A task
 * that opens a route to guests moves it to GUEST_ROUTES.
 */
export const MEMBER_ONLY: Route[] = [
  at("PUT /api/me/workspace", () => "/api/me/workspace", (ids) => ({ workspaceId: ids.workspace })),
  at("GET /api/workspaces/:id/limits", (ids) => `/api/workspaces/${ids.workspace}/limits`),
  at("PATCH /api/workspaces/:id", (ids) => `/api/workspaces/${ids.workspace}`, () => ({ name: "Taken over" })),
  at("GET /api/workspaces/:id/members", (ids) => `/api/workspaces/${ids.workspace}/members`),
  at("PATCH /api/workspaces/:id/members/:userId", (ids) => `/api/workspaces/${ids.workspace}/members/${ids.member}`, () => ({ role: "admin" })),
  at("DELETE /api/workspaces/:id/members/:userId", (ids) => `/api/workspaces/${ids.workspace}/members/${ids.member}`),
  at("POST /api/workspaces/:id/logo", (ids) => `/api/workspaces/${ids.workspace}/logo`, () => ({ contentType: "image/png", size: 10 })),
  at("POST /api/workspaces/:id/logo/:logoId", (ids) => `/api/workspaces/${ids.workspace}/logo/nope`),
  at("DELETE /api/workspaces/:id/logo", (ids) => `/api/workspaces/${ids.workspace}/logo`),
  at("POST /api/workspaces/:id/invitations", (ids) => `/api/workspaces/${ids.workspace}/invitations`, () => ({ emails: ["new@kantor.test"] })),
  at("GET /api/workspaces/:id/invitations", (ids) => `/api/workspaces/${ids.workspace}/invitations`),
  at("DELETE /api/workspaces/:id/invitations/:invitationId", (ids) => `/api/workspaces/${ids.workspace}/invitations/nope`),
  at("POST /api/workspaces/:id/invitations/:invitationId/resend", (ids) => `/api/workspaces/${ids.workspace}/invitations/nope/resend`),
  at("GET /api/workspaces/:id/access", (ids) => `/api/workspaces/${ids.workspace}/access`),
  at("PATCH /api/workspaces/:id/access", (ids) => `/api/workspaces/${ids.workspace}/access`, () => ({ shareCodeOn: true })),
  at("GET /api/workspaces/:id/join-requests", (ids) => `/api/workspaces/${ids.workspace}/join-requests`),
  at("POST /api/workspaces/:id/join-requests/:userId/approve", (ids) => `/api/workspaces/${ids.workspace}/join-requests/${ids.member}/approve`),
  at("DELETE /api/workspaces/:id/join-requests/:userId", (ids) => `/api/workspaces/${ids.workspace}/join-requests/${ids.member}`),
  at("GET /api/projects", (ids) => `/api/projects?workspaceId=${ids.workspace}`),
  at("GET /api/projects/overview", (ids) => `/api/projects/overview?workspaceId=${ids.workspace}`),
  at("POST /api/projects", () => "/api/projects", (ids) => ({ workspaceId: ids.workspace, name: "Mine", slug: "mine", urlPatterns: [] })),
  at("PATCH /api/projects/:id", (ids) => `/api/projects/${ids.p1}`, () => ({ name: "Renamed", slug: "renamed", urlPatterns: [] })),
  at("DELETE /api/projects/:id", (ids) => `/api/projects/${ids.p1}`),
  at("POST /api/projects/:id/guests", (ids) => `/api/projects/${ids.p1}/guests`, () => ({ emails: ["friend@acme.test"] })),
  at("GET /api/projects/:id/guests", (ids) => `/api/projects/${ids.p1}/guests`),
  at("DELETE /api/projects/:id/guests/:userId", (ids) => `/api/projects/${ids.p1}/guests/${ids.member}`),
  at("POST /api/projects/:id/logo", (ids) => `/api/projects/${ids.p1}/logo`, () => ({ contentType: "image/png", size: 10 })),
  at("POST /api/projects/:id/logo/:logoId", (ids) => `/api/projects/${ids.p1}/logo/nope`),
  at("DELETE /api/projects/:id/logo", (ids) => `/api/projects/${ids.p1}/logo`),
  at("POST /api/reports/uploads", () => "/api/reports/uploads", (ids) => ({
    workspaceId: ids.workspace,
    projectId: ids.p1,
    title: "Sneaky",
    captureType: "screenshot",
    mediaSize: 4,
    pageUrl: "https://app.kantor.test/x",
    device: { browser: "Chrome 140", os: "Windows 11", viewport: "1440x900" },
    debuggerSummary: { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] },
  })),
  at("POST /api/reports/:id/parts", (ids) => `/api/reports/${ids.reportP1}/parts`, () => ({ partSize: 5_242_880, parts: 1 })),
  at("POST /api/reports/:id/finalize", (ids) => `/api/reports/${ids.reportP1}/finalize`),
  at("GET /api/reports", (ids) => `/api/reports?workspaceId=${ids.workspace}`),
  at("GET /api/reports/counts", (ids) => `/api/reports/counts?workspaceId=${ids.workspace}`),
  at("GET /api/reports/:id", (ids) => `/api/reports/${ids.reportP1}`),
  at("PATCH /api/reports/:id", (ids) => `/api/reports/${ids.reportP1}`, () => ({ status: "closed" })),
  at("POST /api/reports/:id/fixes", (ids) => `/api/reports/${ids.reportP1}/fixes`, () => ({ url: "https://github.com/a/b/pull/1" })),
  at("DELETE /api/reports/:id/fixes/:fixId", (ids) => `/api/reports/${ids.reportP1}/fixes/nope`),
  at("POST /api/reports/:id/resolve", (ids) => `/api/reports/${ids.reportP1}/resolve`, () => ({ links: ["https://github.com/a/b/pull/1"] })),
  at("POST /api/reports/:id/location", (ids) => `/api/reports/${ids.reportP1}/location`, () => ({ latitude: 1, longitude: 1 })),
  at("POST /api/reports/:id/share/regenerate", (ids) => `/api/reports/${ids.reportP1}/share/regenerate`),
  at("DELETE /api/reports/:id", (ids) => `/api/reports/${ids.reportP1}`),
  at("GET /api/labels", (ids) => `/api/labels?workspaceId=${ids.workspace}`),
  at("POST /api/labels", () => "/api/labels", (ids) => ({ workspaceId: ids.workspace, name: "Mine" })),
  at("PATCH /api/labels/:id", (ids) => `/api/labels/${ids.label}`, () => ({ name: "Renamed" })),
  at("PUT /api/reports/:id/labels", (ids) => `/api/reports/${ids.reportP1}/labels`, () => ({ labelIds: [] })),
  at("DELETE /api/labels/:id", (ids) => `/api/labels/${ids.label}`),
  at("GET /api/reports/:id/comments", (ids) => `/api/reports/${ids.reportP1}/comments`),
  at("POST /api/reports/:id/comments", (ids) => `/api/reports/${ids.reportP1}/comments`, () => ({ body: "Hello" })),
  at("PATCH /api/comments/:id", (ids) => `/api/comments/${ids.commentP1}`, () => ({ body: "Edited" })),
  at("DELETE /api/comments/:id", (ids) => `/api/comments/${ids.commentP1}`),
  at("POST /api/comments/:id/reactions", (ids) => `/api/comments/${ids.commentP1}/reactions`, () => ({ emoji: "👍" })),
  at("GET /api/reports/:id/activity", (ids) => `/api/reports/${ids.reportP1}/activity`),
  at("POST /api/notifications/:id/read", () => "/api/notifications/nope/read"),
  at("GET /api/projects/:id/integrations", (ids) => `/api/projects/${ids.p1}/integrations`),
  at("POST /api/projects/:id/integrations", (ids) => `/api/projects/${ids.p1}/integrations`, (ids) => ({
    connectionId: ids.connection,
    target: { kind: "none" },
  })),
  at("PATCH /api/projects/:id/integrations/:integrationId", (ids) => `/api/projects/${ids.p1}/integrations/${ids.integration}`, () => ({ autoSend: true })),
  at("DELETE /api/projects/:id/integrations/:integrationId", (ids) => `/api/projects/${ids.p1}/integrations/${ids.integration}`),
  at("POST /api/projects/:id/integrations/:integrationId/test", (ids) => `/api/projects/${ids.p1}/integrations/${ids.integration}/test`),
  at("GET /api/workspaces/:id/connections", (ids) => `/api/workspaces/${ids.workspace}/connections`),
  at("POST /api/workspaces/:id/connections", (ids) => `/api/workspaces/${ids.workspace}/connections`, () => ({
    provider: "slack",
    name: "Mine",
    settings: {},
    secret: "https://hooks.slack.com/services/T/B/x",
  })),
  at("PATCH /api/workspaces/:id/connections/:connectionId", (ids) => `/api/workspaces/${ids.workspace}/connections/${ids.connection}`, () => ({ name: "Mine" })),
  at("DELETE /api/workspaces/:id/connections/:connectionId", (ids) => `/api/workspaces/${ids.workspace}/connections/${ids.connection}`),
  at("POST /api/workspaces/:id/connections/:connectionId/test", (ids) => `/api/workspaces/${ids.workspace}/connections/${ids.connection}/test`),
  at("GET /api/workspaces/:id/connections/:connectionId/options", (ids) => `/api/workspaces/${ids.workspace}/connections/${ids.connection}/options?list=targets`),
  at("GET /api/workspaces/:id/ai", (ids) => `/api/workspaces/${ids.workspace}/ai`),
  at("PUT /api/workspaces/:id/ai/provider", (ids) => `/api/workspaces/${ids.workspace}/ai/provider`, () => ({ preset: "openai", model: "gpt", apiKey: "k" })),
  at("DELETE /api/workspaces/:id/ai/provider", (ids) => `/api/workspaces/${ids.workspace}/ai/provider`),
  at("PATCH /api/workspaces/:id/ai/settings", (ids) => `/api/workspaces/${ids.workspace}/ai/settings`, () => ({ sendResponseBodies: true })),
  at("POST /api/workspaces/:id/ai/templates", (ids) => `/api/workspaces/${ids.workspace}/ai/templates`, () => ({ name: "T", skeleton: "", instructions: "" })),
  at("PATCH /api/workspaces/:id/ai/templates/:templateId", (ids) => `/api/workspaces/${ids.workspace}/ai/templates/nope`, () => ({ name: "T", skeleton: "", instructions: "" })),
  at("POST /api/workspaces/:id/ai/write", (ids) => `/api/workspaces/${ids.workspace}/ai/write`, () => ({
    templateId: "nope",
    material: { page: { url: "https://x.test", title: null }, device: { browser: "C", os: "W" }, lines: [], omitted: 0 },
    hint: { title: "", description: "" },
  })),
  at("DELETE /api/workspaces/:id/ai/templates/:templateId", (ids) => `/api/workspaces/${ids.workspace}/ai/templates/nope`),
  at("GET /api/reports/:id/trackers", (ids) => `/api/reports/${ids.reportP1}/trackers`),
  at("POST /api/reports/:id/trackers/:integrationId/send", (ids) => `/api/reports/${ids.reportP1}/trackers/${ids.integration}/send`),
]

/** Routes a guest may use, each with its own tests; moved here from MEMBER_ONLY by the task that opens it. */
export const GUEST_ROUTES: string[] = []

/** The caller's own things, answering a guest and an outsider alike with their own (empty) data. */
const SELF = ["GET /api/workspaces", "GET /api/notifications", "POST /api/notifications/read-all"]

/** Routes that take no id bound to a workspace: sign-in, the caller's account, tokens, links by token, images. */
const PUBLIC = new Set([
  "GET /.well-known/oauth-protected-resource",
  "GET /.well-known/oauth-protected-resource/api/mcp",
  "GET /.well-known/oauth-authorization-server/api/auth",
  "GET /.well-known/oauth-authorization-server",
  "GET /.well-known/openid-configuration",
  "GET /.well-known/openid-configuration/api/auth",
  "OPTIONS /api/",
  "OPTIONS /api/*",
  "GET /api/health",
  "GET /api/auth-methods",
  "GET /api/client-config",
  "GET /api/auth/*",
  "POST /api/auth/*",
  "GET /api/me",
  "GET /api/me/limits",
  "GET /api/me/onboarding",
  "POST /api/me/onboarding",
  "PATCH /api/me",
  "POST /api/me/avatar",
  "POST /api/me/avatar/:avatarId",
  "DELETE /api/me/avatar",
  "GET /api/me/sign-in-methods",
  "GET /api/avatars/:userId/:avatarId",
  "GET /api/me/tokens",
  "POST /api/me/tokens",
  "DELETE /api/me/tokens/:id",
  "GET /api/me/oauth-apps",
  "DELETE /api/me/oauth-apps/:clientId",
  "POST /api/workspaces",
  "GET /api/workspaces/slug",
  "GET /api/workspace-logos/:workspaceId/:logoId",
  "GET /api/invitations/:token",
  "POST /api/invitations/:token/accept",
  "GET /api/me/invitations",
  "POST /api/me/invitations/:id/accept",
  "GET /api/join/domain",
  "POST /api/join/domain/:workspaceId",
  "DELETE /api/join/domain/:workspaceId/request",
  "POST /api/join/preview",
  "POST /api/join",
  "GET /api/join/shared/:code",
  "GET /api/project-logos/:projectId/:logoId",
  "PUT /api/uploads/local/:token",
  "GET /api/files/:token",
  "GET /api/agent-uploads/:token",
  "POST /api/agent-uploads/:token/finalize",
  "GET /api/share/:slug/meta",
  "GET /api/share/:slug/preview.jpg",
  "GET /api/share/:slug",
  "POST /api/mcp",
  "GET /api/mcp",
  "DELETE /api/mcp",
  "POST /api/demo-requests",
])

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ids: Ids
let guest: Awaited<ReturnType<typeof createUserWithToken>>
let outsider: Awaited<ReturnType<typeof createUserWithToken>>

beforeAll(async () => {
  ctx = await setupTestApp()
  const admin = await createUserWithToken(ctx.db, { role: "admin", name: "Admin" })
  const member = await createUserWithToken(ctx.db, { role: "member", name: "Member" })
  guest = await createUserWithToken(ctx.db, { workspaceId: null, name: "Guest", email: "guest@kantor.test" })
  outsider = await createUserWithToken(ctx.db, { workspaceId: null, name: "Outsider", email: "outsider@kantor.test" })
  const p1 = await createProject(ctx.db, { name: "Storefront" })
  const p2 = await createProject(ctx.db, { name: "Back office" })
  await addGuest(ctx.db, p1.id, guest.user.id)
  const reportP1 = await createReadyReport(ctx.db, { projectId: p1.id, reporterId: member.user.id, title: "P1 report" })
  const reportP2 = await createReadyReport(ctx.db, { projectId: p2.id, reporterId: member.user.id, title: "P2 report" })
  const reportNone = await createReadyReport(ctx.db, { reporterId: member.user.id, title: "Loose report" })
  const commentP1 = newId()
  await ctx.db.insert(comment).values({ id: commentP1, reportId: reportP1.id, authorId: member.user.id, body: "Looking" })
  const labelAnswer = await ctx.app.handle(
    new Request("http://localhost/api/labels", {
      method: "POST",
      headers: { ...admin.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Bug" }),
    }),
  )
  const integration = await createIntegration(ctx.db, { projectId: p1.id, provider: "webhook", settings: { url: "https://hooks.kantor.test/x" } as never })
  ids = {
    workspace: ctx.workspace.id,
    p1: p1.id,
    p2: p2.id,
    reportP1: reportP1.id,
    reportP2: reportP2.id,
    reportNone: reportNone.id,
    commentP1,
    label: ((await labelAnswer.json()) as { id: string }).id,
    integration: integration.id,
    connection: integration.connectionId,
    member: member.user.id,
  }
})

const methodOf = (route: string) => route.split(" ")[0]!

async function call(route: Route, who: { headers: Record<string, string> }) {
  const body = route.body?.(ids)
  const response = await ctx.app.handle(
    new Request(`http://localhost${route.path(ids)}`, {
      method: methodOf(route.route),
      headers: { ...who.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  const text = await response.text()
  return { status: response.status, body: text }
}

describe("a project guest is an outsider to every member route", () => {
  test.each(MEMBER_ONLY.map((route) => [route.route, route] as const))("%s gives a guest what it gives an outsider", async (_name, route) => {
    const [asGuest, asOutsider] = await Promise.all([call(route, guest), call(route, outsider)])
    expect(asGuest).toEqual(asOutsider)
    expect([403, 404]).toContain(asGuest.status)
  })

  test.each(SELF)("%s answers a guest like an outsider", async (name) => {
    const route = at(name, () => name.split(" ")[1]!)
    expect(await call(route, guest)).toEqual(await call(route, outsider))
  })

  test("MCP: a guest's token finds no workspace and no report", async () => {
    const client = await mcpClient(ctx.app, guest.headers)
    expect((await callTool(client, "listWorkspaces")).text).toBe("You are not in any workspace yet.")
    expect((await callTool(client, "getReport", { report: ids.reportP1 })).isError).toBe(true)
    expect((await callTool(client, "searchReports", {})).isError).toBe(true)
  })

  test("the lists cover every route", () => {
    const routes = (ctx.app as unknown as { routes: Array<{ method: string; path: string }> }).routes.map((r) => `${r.method} ${r.path}`)
    const known = new Set([...PUBLIC, ...SELF, ...GUEST_ROUTES, ...MEMBER_ONLY.map((route) => route.route)])
    expect(routes.filter((route) => !known.has(route))).toEqual([])
    expect([...known].filter((route) => !routes.includes(route))).toEqual([])
  })
})
