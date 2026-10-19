import { beforeEach, describe, expect, test } from "bun:test"
import {
  createProject,
  createReadyReport,
  createUserWithToken,
  createWorkspaceRow,
  setupTestApp,
  uploadBody,
} from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const status = (result: { error: { status: unknown } | null }) => result.error?.status as number | undefined
const code = (result: { error: { value: unknown } | null }) => (result.error?.value as { code?: string } | undefined)?.code

describe("reports belong to a workspace", () => {
  test("lists only the requested workspace", async () => {
    const me = await createUserWithToken(ctx.db)
    const other = await createWorkspaceRow(ctx.db, "Other")
    const stranger = await createUserWithToken(ctx.db, { workspaceId: other.id })
    await createReadyReport(ctx.db, { reporterId: me.user.id, title: "Mine" })
    await createReadyReport(ctx.db, { reporterId: stranger.user.id, title: "Theirs", workspaceId: other.id })
    const { data } = await ctx.api.api.reports.get({ query: { workspaceId: ctx.workspace.id }, headers: me.headers })
    expect(data?.items.map((item) => item.title)).toEqual(["Mine"])
    const { data: current } = await ctx.api.api.reports.get({ query: {}, headers: me.headers })
    expect(current?.items.map((item) => item.title)).toEqual(["Mine"])
    expect(status(await ctx.api.api.reports.get({ query: { workspaceId: other.id }, headers: me.headers }))).toBe(404)
  })

  test("an outsider gets 404 on every report route", async () => {
    const owner = await createUserWithToken(ctx.db)
    const target = await createReadyReport(ctx.db, { reporterId: owner.user.id })
    const other = await createWorkspaceRow(ctx.db, "Other")
    const outsider = await createUserWithToken(ctx.db, { workspaceId: other.id, workspaceRole: "admin" })
    const headers = outsider.headers
    const reports = ctx.api.api.reports({ id: target.id })
    expect(status(await reports.get({ headers }))).toBe(404)
    expect(status(await reports.patch({ title: "Hacked" }, { headers }))).toBe(404)
    expect(status(await reports.comments.get({ headers }))).toBe(404)
    expect(status(await reports.comments.post({ body: "hi" }, { headers }))).toBe(404)
    expect(status(await reports.trackers.get({ headers }))).toBe(404)
    expect(status(await reports.share.regenerate.post(undefined, { headers }))).toBe(404)
    expect(status(await reports.delete(undefined, { headers }))).toBe(404)
  })

  test("only the reporter or an admin changes visibility", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const colleague = await createUserWithToken(ctx.db)
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id })
    const reports = ctx.api.api.reports({ id: target.id })
    expect(status(await reports.patch({ visibility: "public" }, { headers: colleague.headers }))).toBe(403)
    expect((await reports.patch({ status: "in_progress" }, { headers: colleague.headers })).data?.status).toBe("in_progress")
    expect((await reports.patch({ visibility: "public" }, { headers: reporter.headers })).data?.visibility).toBe("public")
    expect((await reports.patch({ visibility: "workspace" }, { headers: admin.headers })).data?.visibility).toBe("workspace")
  })

  test("internal is refused for free email reporters", async () => {
    ctx = await setupTestApp({ allowedEmailDomains: ["kantor.test", "gmail.com"] })
    const gmail = await createUserWithToken(ctx.db, { email: "budi@gmail.com" })
    const target = await createReadyReport(ctx.db, { reporterId: gmail.user.id, reporterDomain: "gmail.com" })
    const patched = await ctx.api.api.reports({ id: target.id }).patch({ visibility: "internal" }, { headers: gmail.headers })
    expect([status(patched), code(patched)]).toEqual([422, "internal_unavailable"])
    const uploaded = await ctx.api.api.reports.uploads.post(uploadBody(null, { visibility: "internal" }), { headers: gmail.headers })
    expect([status(uploaded), code(uploaded)]).toEqual([422, "internal_unavailable"])
  })

  test("assignee must be a workspace member", async () => {
    const me = await createUserWithToken(ctx.db)
    const other = await createWorkspaceRow(ctx.db, "Other")
    const stranger = await createUserWithToken(ctx.db, { workspaceId: other.id })
    const target = await createReadyReport(ctx.db, { reporterId: me.user.id })
    const patched = await ctx.api.api.reports({ id: target.id }).patch({ assigneeId: stranger.user.id }, { headers: me.headers })
    expect([status(patched), code(patched)]).toEqual([422, "assignee_not_found"])
  })

  test("project must be in the report's workspace", async () => {
    const me = await createUserWithToken(ctx.db)
    const other = await createWorkspaceRow(ctx.db, "Other")
    const theirs = await createProject(ctx.db, { workspaceId: other.id })
    const target = await createReadyReport(ctx.db, { reporterId: me.user.id })
    const patched = await ctx.api.api.reports({ id: target.id }).patch({ projectId: theirs.id }, { headers: me.headers })
    expect([status(patched), code(patched)]).toEqual([422, "project_not_found"])
    const uploaded = await ctx.api.api.reports.uploads.post(uploadBody(theirs.id), { headers: me.headers })
    expect([status(uploaded), code(uploaded)]).toEqual([422, "project_not_found"])
  })

  test("new reports default to workspace visibility", async () => {
    const me = await createUserWithToken(ctx.db)
    const { data } = await ctx.api.api.reports.uploads.post(uploadBody(null), { headers: me.headers })
    const { data: detail } = await ctx.api.api.reports({ id: data?.reportId ?? "" }).get({ headers: me.headers })
    expect(detail?.visibility).toBe("workspace")
    expect(detail?.workspaceId).toBe(ctx.workspace.id)
    expect(detail?.internalDomain).toBe("kantor.test")
  })
})
