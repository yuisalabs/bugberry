import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { comment, report, user } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { guestFixture, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let f: Awaited<ReturnType<typeof guestFixture>>

type Who = { headers: Record<string, string> }
const call = (method: string, path: string, who: Who | null, body?: unknown) =>
  ctx.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...(who?.headers ?? {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
const get = async (path: string, who: Who | null) => (await call("GET", path, who)).json() as Promise<any>
const ids = (answer: { items: Array<{ id: string }> }) => answer.items.map((item) => item.id)
const query = (params: Record<string, string>) => new URLSearchParams(params).toString()
const list = (who: Who, params: Record<string, string> = {}) => get(`/api/reports?${query(params)}`, who)
const counts = (who: Who, params: Record<string, string> = {}) => get(`/api/reports/counts?${query(params)}`, who)

beforeEach(async () => {
  ctx = await setupTestApp()
  f = await guestFixture(ctx.db)
})

describe("what a guest reads", () => {
  test("a guest's workspaces are listed only when asked for", async () => {
    expect(await get("/api/workspaces", f.guest)).toEqual([])
    expect(await get("/api/workspaces?include=guest", f.guest)).toMatchObject([{ id: ctx.workspace.id, role: "guest", owner: false }])
    expect(await get("/api/workspaces?include=guest", f.member)).toMatchObject([{ id: ctx.workspace.id, role: "member" }])
  })

  test("a guest can make the guest workspace their current one", async () => {
    expect((await call("PUT", "/api/me/workspace", f.guest, { workspaceId: ctx.workspace.id })).status).toBe(200)
  })

  test("a guest sees their projects and nothing of the others", async () => {
    expect((await get(`/api/projects?workspaceId=${ctx.workspace.id}`, f.guest)).map((p: { id: string }) => p.id)).toEqual([f.p1.id])
  })

  test("a guest's list holds their project's reports only", async () => {
    const w = ctx.workspace.id
    expect(ids(await list(f.guest, { workspaceId: w }))).toEqual([f.reportP1.id])
    expect(ids(await list(f.guest, { workspaceId: w, projectId: f.p2.id }))).toEqual([])
    expect(ids(await list(f.guest, { workspaceId: w, projectId: "none" }))).toEqual([])
    expect((await counts(f.guest, { workspaceId: w })).total).toBe(1)
    expect((await counts(f.guest, { workspaceId: w, projectId: f.p2.id })).total).toBe(0)
  })

  test("a guest's list names who a report is assigned to", async () => {
    await ctx.db.update(report).set({ assigneeId: f.member.user.id }).where(eq(report.id, f.reportP1.id))
    const [item] = (await list(f.guest, { workspaceId: ctx.workspace.id })).items
    expect(item.assignee).toEqual({ id: f.member.user.id, name: f.member.user.name, image: null })
  })

  test("a guest's search never reaches another project", async () => {
    await ctx.db.insert(comment).values({ id: newId(), reportId: f.reportNone.id, authorId: f.member.user.id, body: "zebrafinch again" })
    const w = ctx.workspace.id
    expect(ids(await list(f.guest, { workspaceId: w, q: "zebrafinch" }))).toEqual([])
    expect((await counts(f.guest, { workspaceId: w, q: "zebrafinch" })).total).toBe(0)
  })

  test("a guest opens their project's report without the members' fields", async () => {
    const detail = await get(`/api/reports/${f.reportP1.id}`, f.guest)
    expect(detail.id).toBe(f.reportP1.id)
    expect(detail.mediaUrl).toBeTruthy()
    for (const key of ["reporterEmail", "location", "fixes", "labels"]) expect(detail[key]).toBeUndefined()
  })

  test("another project's report, and one without a project, are 404 for a guest", async () => {
    for (const id of [f.reportP2.id, f.reportNone.id]) {
      const answer = await call("GET", `/api/reports/${id}`, f.guest)
      expect(answer.status).toBe(404)
      expect((await answer.json()) as unknown).toMatchObject({ code: "report_not_found" })
    }
  })

  test("a report moved out of the project is 404 at once", async () => {
    await ctx.db.update(report).set({ projectId: f.p2.id }).where(eq(report.id, f.reportP1.id))
    expect((await call("GET", `/api/reports/${f.reportP1.id}`, f.guest)).status).toBe(404)
  })

  test("a guest with no project left has no workspace", async () => {
    await call("DELETE", `/api/projects/${f.p1.id}/guests/${f.guest.user.id}`, f.admin)
    expect(await get("/api/workspaces?include=guest", f.guest)).toEqual([])
    expect((await call("GET", `/api/reports?workspaceId=${ctx.workspace.id}`, f.guest)).status).toBe(404)
  })

  test("a guest-only account's current workspace is the guest one", async () => {
    await ctx.db.update(user).set({ lastWorkspaceId: null }).where(eq(user.id, f.guest.user.id))
    expect(ids(await list(f.guest))).toEqual([f.reportP1.id])
  })

  test("a workspace-only share link opens for the project's guest and not for another project's", async () => {
    const own = await get(`/api/share/${f.reportP1.shareSlug}`, f.guest)
    expect(own.id).toBe(f.reportP1.id)
    expect(own.viewerIsMember).toBe(true)
    expect((await call("GET", `/api/share/${f.reportP2.shareSlug}`, f.guest)).status).toBe(404)
  })

  test("members see what they saw", async () => {
    const w = ctx.workspace.id
    expect(ids(await list(f.member, { workspaceId: w })).sort()).toEqual([f.reportP1.id, f.reportP2.id, f.reportNone.id].sort())
    expect((await counts(f.member, { workspaceId: w })).total).toBe(3)
    const detail = await get(`/api/reports/${f.reportP1.id}`, f.member)
    expect(detail.reporterEmail).toBe("member@kantor.test")
    expect(detail.labels).toEqual([])
  })
})
