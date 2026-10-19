import { beforeEach, describe, expect, test } from "bun:test"
import { eq, inArray } from "drizzle-orm"
import { comment, integration, project, report, workspace, workspaceInvitation, workspaceMember } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { createSecretBox } from "../src/lib/secret-box"
import {
  createProject,
  createReadyReport,
  createUserWithToken,
  createWorkspaceRow,
  sessionHeaders,
  setupTestApp,
  TEST_ENCRYPTION_KEY,
  uploadBody,
} from "./helpers"

/**
 * Workspace A's admin tries every route against workspace B's data, with a dashboard session and with
 * an API token. Nothing may come back, and nothing of B's may change.
 */
let ctx: Awaited<ReturnType<typeof setupTestApp>>
let b: {
  workspaceId: string
  adminId: string
  projectId: string
  integrationId: string
  reportId: string
  shareSlug: string
  commentId: string
  invitationId: string
}
let attacker: { token: Record<string, string>; session: Record<string, string> }

beforeEach(async () => {
  ctx = await setupTestApp({ allowedEmailDomains: ["a.test", "b.test"] })
  const a = await createUserWithToken(ctx.db, { email: "a@a.test", role: "admin" })
  attacker = { token: a.headers, session: await sessionHeaders(ctx, a.user.id) }

  const bWorkspace = await createWorkspaceRow(ctx.db, "B")
  const bAdmin = await createUserWithToken(ctx.db, { email: "b@b.test", workspaceId: bWorkspace.id, workspaceRole: "admin" })
  const bProject = await createProject(ctx.db, { workspaceId: bWorkspace.id, slug: "secret" })
  const integrationId = newId()
  await ctx.db.insert(integration).values({
    id: integrationId,
    projectId: bProject.id,
    provider: "github",
    config: { owner: "b", repo: "secret", labels: [] },
    secretEncrypted: createSecretBox(TEST_ENCRYPTION_KEY).seal("ghp_secret"),
  })
  const bReport = await createReadyReport(ctx.db, {
    reporterId: bAdmin.user.id,
    workspaceId: bWorkspace.id,
    projectId: bProject.id,
    title: "B's private bug",
    reporterDomain: "b.test",
  })
  const commentId = newId()
  await ctx.db.insert(comment).values({ id: commentId, reportId: bReport.id, authorId: bAdmin.user.id, body: "secret note" })
  const invitationId = newId()
  await ctx.db.insert(workspaceInvitation).values({
    id: invitationId,
    workspaceId: bWorkspace.id,
    email: "new@b.test",
    tokenHash: newId(),
    invitedById: bAdmin.user.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  b = {
    workspaceId: bWorkspace.id,
    adminId: bAdmin.user.id,
    projectId: bProject.id,
    integrationId,
    reportId: bReport.id,
    shareSlug: bReport.shareSlug,
    commentId,
    invitationId,
  }
})

/** Everything of B's, to compare before and after. */
async function snapshotOfB() {
  return JSON.stringify({
    workspace: await ctx.db.select().from(workspace).where(eq(workspace.id, b.workspaceId)),
    members: await ctx.db.select().from(workspaceMember).where(eq(workspaceMember.workspaceId, b.workspaceId)),
    invitations: await ctx.db.select().from(workspaceInvitation).where(eq(workspaceInvitation.workspaceId, b.workspaceId)),
    projects: await ctx.db.select().from(project).where(eq(project.workspaceId, b.workspaceId)),
    integrations: await ctx.db.select().from(integration).where(eq(integration.projectId, b.projectId)),
    reports: await ctx.db.select().from(report).where(eq(report.workspaceId, b.workspaceId)),
    comments: await ctx.db.select().from(comment).where(inArray(comment.reportId, [b.reportId])),
  })
}

type Case = { name: string; method: string; path: () => string; body?: () => unknown; expect: number[] }

const NOT_FOUND = [404]
const cases: Case[] = [
  { name: "members of B", method: "GET", path: () => `/workspaces/${b.workspaceId}/members`, expect: NOT_FOUND },
  { name: "rename B", method: "PATCH", path: () => `/workspaces/${b.workspaceId}`, body: () => ({ name: "Mine now" }), expect: NOT_FOUND },
  {
    name: "promote in B",
    method: "PATCH",
    path: () => `/workspaces/${b.workspaceId}/members/${b.adminId}`,
    body: () => ({ role: "member" }),
    expect: NOT_FOUND,
  },
  { name: "remove from B", method: "DELETE", path: () => `/workspaces/${b.workspaceId}/members/${b.adminId}`, expect: NOT_FOUND },
  { name: "B's invitations", method: "GET", path: () => `/workspaces/${b.workspaceId}/invitations`, expect: NOT_FOUND },
  {
    name: "invite into B",
    method: "POST",
    path: () => `/workspaces/${b.workspaceId}/invitations`,
    body: () => ({ emails: ["spy@a.test"] }),
    expect: NOT_FOUND,
  },
  {
    name: "revoke B's invitation",
    method: "DELETE",
    path: () => `/workspaces/${b.workspaceId}/invitations/${b.invitationId}`,
    expect: NOT_FOUND,
  },
  {
    name: "resend B's invitation",
    method: "POST",
    path: () => `/workspaces/${b.workspaceId}/invitations/${b.invitationId}/resend`,
    expect: NOT_FOUND,
  },
  { name: "B's projects", method: "GET", path: () => `/projects?workspaceId=${b.workspaceId}`, expect: NOT_FOUND },
  {
    name: "create a project in B",
    method: "POST",
    path: () => "/projects",
    body: () => ({ workspaceId: b.workspaceId, name: "X", slug: "x", urlPatterns: [] }),
    expect: NOT_FOUND,
  },
  { name: "edit B's project", method: "PATCH", path: () => `/projects/${b.projectId}`, body: () => ({ name: "X" }), expect: NOT_FOUND },
  { name: "delete B's project", method: "DELETE", path: () => `/projects/${b.projectId}`, expect: NOT_FOUND },
  { name: "B's integrations", method: "GET", path: () => `/projects/${b.projectId}/integrations`, expect: NOT_FOUND },
  {
    name: "add an integration to B",
    method: "POST",
    path: () => `/projects/${b.projectId}/integrations`,
    body: () => ({ provider: "github", config: { owner: "a", repo: "a", labels: [] }, secret: "x" }),
    expect: NOT_FOUND,
  },
  {
    name: "edit B's integration",
    method: "PATCH",
    path: () => `/projects/${b.projectId}/integrations/${b.integrationId}`,
    body: () => ({ autoSend: true }),
    expect: NOT_FOUND,
  },
  {
    name: "delete B's integration",
    method: "DELETE",
    path: () => `/projects/${b.projectId}/integrations/${b.integrationId}`,
    expect: NOT_FOUND,
  },
  {
    name: "test B's integration",
    method: "POST",
    path: () => `/projects/${b.projectId}/integrations/${b.integrationId}/test`,
    expect: NOT_FOUND,
  },
  { name: "B's reports", method: "GET", path: () => `/reports?workspaceId=${b.workspaceId}`, expect: NOT_FOUND },
  { name: "B's report", method: "GET", path: () => `/reports/${b.reportId}`, expect: NOT_FOUND },
  { name: "edit B's report", method: "PATCH", path: () => `/reports/${b.reportId}`, body: () => ({ visibility: "public" }), expect: NOT_FOUND },
  { name: "delete B's report", method: "DELETE", path: () => `/reports/${b.reportId}`, expect: NOT_FOUND },
  { name: "reset B's share link", method: "POST", path: () => `/reports/${b.reportId}/share/regenerate`, expect: NOT_FOUND },
  { name: "finalize B's report", method: "POST", path: () => `/reports/${b.reportId}/finalize`, expect: NOT_FOUND },
  { name: "B's comments", method: "GET", path: () => `/reports/${b.reportId}/comments`, expect: NOT_FOUND },
  {
    name: "comment on B's report",
    method: "POST",
    path: () => `/reports/${b.reportId}/comments`,
    body: () => ({ body: "hi" }),
    expect: NOT_FOUND,
  },
  { name: "edit B's comment", method: "PATCH", path: () => `/comments/${b.commentId}`, body: () => ({ body: "x" }), expect: NOT_FOUND },
  { name: "delete B's comment", method: "DELETE", path: () => `/comments/${b.commentId}`, expect: NOT_FOUND },
  { name: "B's trackers", method: "GET", path: () => `/reports/${b.reportId}/trackers`, expect: NOT_FOUND },
  {
    name: "send B's report to B's tracker",
    method: "POST",
    path: () => `/reports/${b.reportId}/trackers/${b.integrationId}/send`,
    expect: NOT_FOUND,
  },
  {
    name: "upload into B",
    method: "POST",
    path: () => "/reports/uploads",
    body: () => uploadBody(null, { workspaceId: b.workspaceId }),
    expect: NOT_FOUND,
  },
  {
    name: "upload into my workspace with B's project",
    method: "POST",
    path: () => "/reports/uploads",
    body: () => uploadBody(b.projectId),
    expect: [422],
  },
  { name: "make B current", method: "PUT", path: () => "/me/workspace", body: () => ({ workspaceId: b.workspaceId }), expect: NOT_FOUND },
  { name: "B's workspace-level report by link", method: "GET", path: () => `/share/${b.shareSlug}`, expect: NOT_FOUND },
]

describe("workspace isolation", () => {
  for (const via of ["session", "token"] as const) {
    for (const item of cases) {
      test(`${item.name} (${via})`, async () => {
        const before = await snapshotOfB()
        const body = item.body?.()
        const response = await ctx.app.handle(
          new Request(`http://localhost/api${item.path()}`, {
            method: item.method,
            headers: { ...attacker[via], ...(body === undefined ? {} : { "content-type": "application/json" }) },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        const answer = { status: response.status, body: await response.text() }
        expect({ ...answer, allowed: item.expect.includes(answer.status) }).toMatchObject({ allowed: true })
        expect(await snapshotOfB()).toBe(before)
      })
    }
  }

  test("searching finds nothing of B's", async () => {
    const response = await ctx.app.handle(
      new Request(`http://localhost/api/reports?q=${encodeURIComponent("B's private bug")}`, { headers: attacker.session }),
    )
    const body = (await response.json()) as { items: unknown[] }
    expect(body.items).toEqual([])
  })
})
