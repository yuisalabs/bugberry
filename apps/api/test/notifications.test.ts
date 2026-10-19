import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { workspaceMember } from "../src/db/schema"
import { renderMentions } from "../src/modules/comments/mentions"
import { createCommentsService } from "../src/modules/comments/service"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let reportId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana" })
  budi = await createUserWithToken(ctx.db, { name: "Budi" })
  const project = await createProject(ctx.db)
  reportId = (await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id, title: "Pay button fails" })).id
})

const tag = (id: string) => `@[user:${id}]`
const post = (by: typeof ana, body: string) => ctx.api.api.reports({ id: reportId }).comments.post({ body }, { headers: by.headers })
const list = (by: typeof ana) => ctx.api.api.notifications.get({ headers: by.headers })

describe("renderMentions", () => {
  test("shows names for members and a placeholder for anyone else", () => {
    expect(renderMentions("hi @[user:a] and @[user:x]", new Map([["a", "Ana"]]))).toBe("hi @Ana and @former member")
  })
})

describe("notifications", () => {
  test("lists my mentions, newest first, with an unread count", async () => {
    await post(ana, `${tag(budi.user.id)} first`)
    const second = (await post(ana, `${tag(budi.user.id)} second`)).data?.id
    await post(ana, "no mention")

    const { data } = await list(budi)
    expect(data?.unreadCount).toBe(2)
    expect(data?.items).toHaveLength(2)
    expect(data?.items[0]).toMatchObject({
      read: false,
      commentId: second,
      actor: { id: ana.user.id, name: "Ana" },
      report: { id: reportId, number: expect.any(Number), title: "Pay button fails" },
      snippet: "@Budi second",
    })
    expect((await list(ana)).data).toEqual({ items: [], unreadCount: 0 })
  })

  test("the snippet shows names and the current comment text", async () => {
    const id = (await post(ana, `${tag(budi.user.id)} tolong cek`)).data?.id ?? ""
    await ctx.api.api.comments({ id }).patch({ body: `${tag(budi.user.id)}   sudah   diperbaiki\n${tag(ana.user.id)}` }, { headers: ana.headers })
    expect((await list(budi)).data?.items[0]?.snippet).toBe("@Budi sudah diperbaiki @Ana")

    await ctx.api.api.comments({ id }).patch({ body: `${tag(budi.user.id)} ${"x".repeat(300)}` }, { headers: ana.headers })
    const snippet = (await list(budi)).data?.items[0]?.snippet ?? ""
    expect(snippet).toHaveLength(140)
    expect(snippet.endsWith("…")).toBe(true)
  })

  test("marking one read, then all read", async () => {
    await post(ana, `${tag(budi.user.id)} one`)
    await post(ana, `${tag(budi.user.id)} two`)
    const first = (await list(budi)).data?.items[0]?.id ?? ""
    expect((await ctx.api.api.notifications({ id: first }).read.post(undefined, { headers: budi.headers })).data).toEqual({ ok: true })
    const after = (await list(budi)).data
    expect(after?.unreadCount).toBe(1)
    expect(after?.items[0]?.read).toBe(true)

    expect((await ctx.api.api.notifications["read-all"].post(undefined, { headers: budi.headers })).data).toEqual({ ok: true })
    expect((await list(budi)).data?.unreadCount).toBe(0)
  })

  test("someone else's notification cannot be marked", async () => {
    await post(ana, `${tag(budi.user.id)} one`)
    const id = (await list(budi)).data?.items[0]?.id ?? ""
    const { error } = await ctx.api.api.notifications({ id }).read.post(undefined, { headers: ana.headers })
    expect(error?.status as number | undefined).toBe(404)
    await ctx.api.api.notifications["read-all"].post(undefined, { headers: ana.headers })
    expect((await list(budi)).data?.unreadCount).toBe(1)
  })

  test("notifications from a workspace you left are hidden", async () => {
    await post(ana, `${tag(budi.user.id)} one`)
    expect((await list(budi)).data?.unreadCount).toBe(1)
    await ctx.db
      .delete(workspaceMember)
      .where(and(eq(workspaceMember.userId, budi.user.id), eq(workspaceMember.workspaceId, ctx.workspace.id)))
    expect((await list(budi)).data).toEqual({ items: [], unreadCount: 0 })
  })

  test("anonymous callers get 401", async () => {
    expect((await ctx.api.api.notifications.get()).error?.status as number | undefined).toBe(401)
    expect((await ctx.api.api.notifications["read-all"].post()).error?.status as number | undefined).toBe(401)
  })
})

describe("notifications via AI", () => {
  test("a mention written by an AI app says so", async () => {
    await createCommentsService(ctx).create(ana.user, reportId, `${tag(budi.user.id)} look`, { viaAgent: "Cursor" })
    await post(ana, `${tag(budi.user.id)} by hand`)
    const { data } = await list(budi)
    expect(data?.items.map((item) => item.viaAgent)).toEqual([null, "Cursor"])
  })
})
