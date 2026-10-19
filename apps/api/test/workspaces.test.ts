import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq, inArray } from "drizzle-orm"
import { report, user, workspaceMember } from "../src/db/schema"
import {
  addMember,
  createProject,
  createReadyReport,
  createUser,
  createUserWithToken,
  createWorkspaceRow,
  setupTestApp,
} from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const status = (result: { error: { status: unknown } | null }) => result.error?.status as number | undefined

describe("workspaces", () => {
  test("lists only my workspaces with my role", async () => {
    const me = await createUserWithToken(ctx.db, { role: "admin" })
    const other = await createWorkspaceRow(ctx.db, "Another")
    await addMember(ctx.db, other.id, me.user.id, "member")
    await createWorkspaceRow(ctx.db, "Not mine")
    const { data } = await ctx.api.api.workspaces.get({ headers: me.headers })
    expect(data).toEqual([
      { id: other.id, name: "Another", role: "member", owner: false, slug: "another", logoUrl: null },
      { id: ctx.workspace.id, name: "Test", role: "admin", owner: false, slug: "test", logoUrl: null },
    ])
  })

  test("anyone can create a workspace and becomes its admin; only admins rename", async () => {
    const me = await createUserWithToken(ctx.db)
    const { data: created } = await ctx.api.api.workspaces.post({ name: "Side project" }, { headers: me.headers })
    expect(created).toMatchObject({ name: "Side project", role: "admin" })
    expect(status(await ctx.api.api.workspaces({ id: ctx.workspace.id }).patch({ name: "X" }, { headers: me.headers }))).toBe(403)
    const { data: renamed } = await ctx.api.api
      .workspaces({ id: created?.id ?? "" })
      .patch({ name: "Renamed" }, { headers: me.headers })
    expect(renamed).toMatchObject({ name: "Renamed" })
  })

  test("members are listed per workspace", async () => {
    const me = await createUserWithToken(ctx.db, { name: "Budi" })
    await createUser(ctx.db, { name: "Ana", email: "ana@kantor.test" })
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    await createUser(ctx.db, { name: "Zed", workspaceId: elsewhere.id })
    const { data } = await ctx.api.api.workspaces({ id: ctx.workspace.id }).members.get({ headers: me.headers })
    expect(data?.map((member) => [member.name, member.role])).toEqual([
      ["Ana", "member"],
      ["Budi", "member"],
    ])
    expect(status(await ctx.api.api.workspaces({ id: elsewhere.id }).members.get({ headers: me.headers }))).toBe(404)
  })

  test("admins change roles; members cannot", async () => {
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const member = await createUserWithToken(ctx.db)
    const target = await createUser(ctx.db)
    const members = ctx.api.api.workspaces({ id: ctx.workspace.id }).members
    expect(status(await members({ userId: target.id }).patch({ role: "admin" }, { headers: member.headers }))).toBe(403)
    const { data } = await members({ userId: target.id }).patch({ role: "admin" }, { headers: admin.headers })
    expect(data).toMatchObject({ id: target.id, role: "admin", owner: false })
  })

  test("the last admin cannot be demoted or leave", async () => {
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const members = ctx.api.api.workspaces({ id: ctx.workspace.id }).members
    const demote = await members({ userId: admin.user.id }).patch({ role: "member" }, { headers: admin.headers })
    expect(demote.error?.value).toMatchObject({ code: "last_admin" })
    const leave = await members({ userId: admin.user.id }).delete(undefined, { headers: admin.headers })
    expect(leave.error?.value).toMatchObject({ code: "last_admin" })
  })

  test("two admins demoting each other at the same time leave one admin", async () => {
    const ana = await createUserWithToken(ctx.db, { role: "admin" })
    const budi = await createUserWithToken(ctx.db, { role: "admin" })
    const members = ctx.api.api.workspaces({ id: ctx.workspace.id }).members
    const admins = and(eq(workspaceMember.workspaceId, ctx.workspace.id), eq(workspaceMember.role, "admin"))
    for (let round = 0; round < 5; round++) {
      await ctx.db
        .update(workspaceMember)
        .set({ role: "admin" })
        .where(and(eq(workspaceMember.workspaceId, ctx.workspace.id), inArray(workspaceMember.userId, [ana.user.id, budi.user.id])))
      await Promise.all([
        members({ userId: budi.user.id }).patch({ role: "member" }, { headers: ana.headers }),
        members({ userId: ana.user.id }).patch({ role: "member" }, { headers: budi.headers }),
      ])
      const left = await ctx.db.select({ id: workspaceMember.userId }).from(workspaceMember).where(admins)
      expect({ round, admins: left.length }).toEqual({ round, admins: 1 })
    }
  })

  test("a removed member loses access and their assignments", async () => {
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const budi = await createUserWithToken(ctx.db)
    const assigned = await createReadyReport(ctx.db, { reporterId: admin.user.id, assigneeId: budi.user.id })
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    await addMember(ctx.db, elsewhere.id, budi.user.id)
    const kept = await createReadyReport(ctx.db, { reporterId: budi.user.id, assigneeId: budi.user.id, workspaceId: elsewhere.id })

    const removed = await ctx.api.api
      .workspaces({ id: ctx.workspace.id })
      .members({ userId: budi.user.id })
      .delete(undefined, { headers: admin.headers })
    expect(removed.data).toEqual({ ok: true })
    expect(status(await ctx.api.api.projects.get({ query: { workspaceId: ctx.workspace.id }, headers: budi.headers }))).toBe(404)
    const [cleared] = await ctx.db.select({ assigneeId: report.assigneeId }).from(report).where(eq(report.id, assigned.id))
    expect(cleared?.assigneeId).toBeNull()
    const [untouched] = await ctx.db.select({ assigneeId: report.assigneeId }).from(report).where(eq(report.id, kept.id))
    expect(untouched?.assigneeId).toBe(budi.user.id)
    const [row] = await ctx.db.select({ last: user.lastWorkspaceId }).from(user).where(eq(user.id, budi.user.id))
    expect(row?.last).toBeNull()
  })

  test("members may leave by themselves but not remove others", async () => {
    await createUserWithToken(ctx.db, { role: "admin" })
    const member = await createUserWithToken(ctx.db)
    const other = await createUser(ctx.db)
    const members = ctx.api.api.workspaces({ id: ctx.workspace.id }).members
    expect(status(await members({ userId: other.id }).delete(undefined, { headers: member.headers }))).toBe(403)
    expect((await members({ userId: member.user.id }).delete(undefined, { headers: member.headers })).data).toEqual({ ok: true })
  })

  test("switching the current workspace needs membership", async () => {
    const me = await createUserWithToken(ctx.db)
    const mine = await createWorkspaceRow(ctx.db, "Mine")
    await addMember(ctx.db, mine.id, me.user.id)
    const notMine = await createWorkspaceRow(ctx.db, "Not mine")
    expect(status(await ctx.api.api.me.workspace.put({ workspaceId: notMine.id }, { headers: me.headers }))).toBe(404)
    expect((await ctx.api.api.me.workspace.put({ workspaceId: mine.id }, { headers: me.headers })).data).toEqual({ ok: true })
    expect((await ctx.api.api.me.get({ headers: me.headers })).data?.lastWorkspaceId).toBe(mine.id)
  })

  test("a role change without a role is rejected instead of defaulting", async () => {
    const { headers } = await createUserWithToken(ctx.db, { role: "admin" })
    const target = await createUser(ctx.db)
    const response = await ctx.app.handle(
      new Request(`http://localhost/api/workspaces/${ctx.workspace.id}/members/${target.id}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: "{}",
      }),
    )
    expect(response.status).toBe(422)
  })

  test("unknown members return 404", async () => {
    const { headers } = await createUserWithToken(ctx.db, { role: "admin" })
    const stranger = await createUser(ctx.db, { workspaceId: null })
    const result = await ctx.api.api
      .workspaces({ id: ctx.workspace.id })
      .members({ userId: stranger.id })
      .patch({ role: "admin" }, { headers })
    expect(status(result)).toBe(404)
  })
})

describe("projects per workspace", () => {
  test("the same slug may exist in two workspaces", async () => {
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const other = await createWorkspaceRow(ctx.db, "Other")
    await createProject(ctx.db, { slug: "web", workspaceId: other.id })
    const { data } = await ctx.api.api.projects.post(
      { workspaceId: ctx.workspace.id, name: "Web", slug: "web", urlPatterns: [] },
      { headers: admin.headers },
    )
    expect(data?.workspaceId).toBe(ctx.workspace.id)
  })

  test("lists only the workspace's projects", async () => {
    const me = await createUserWithToken(ctx.db)
    const other = await createWorkspaceRow(ctx.db, "Other")
    await createProject(ctx.db, { name: "Mine" })
    await createProject(ctx.db, { name: "Theirs", workspaceId: other.id })
    const { data } = await ctx.api.api.projects.get({ query: { workspaceId: ctx.workspace.id }, headers: me.headers })
    expect(data?.map((p) => p.name)).toEqual(["Mine"])
  })

  test("an admin elsewhere cannot edit or delete a project here", async () => {
    const other = await createWorkspaceRow(ctx.db, "Other")
    const outsider = await createUserWithToken(ctx.db, { workspaceId: other.id, workspaceRole: "admin" })
    const target = await createProject(ctx.db)
    expect(status(await ctx.api.api.projects({ id: target.id }).patch({ name: "Hacked" }, { headers: outsider.headers }))).toBe(404)
    expect(status(await ctx.api.api.projects({ id: target.id }).delete(undefined, { headers: outsider.headers }))).toBe(404)
  })
})
