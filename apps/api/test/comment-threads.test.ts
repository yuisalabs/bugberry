import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { comment } from "../src/db/schema"
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
  reportId = (await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id })).id
})

const comments = (id = reportId) => ctx.api.api.reports({ id }).comments
const post = async (who: { headers: Record<string, string> }, body: string, replyTo?: string) => {
  const { data, error } = await comments().post(replyTo ? { body, replyTo } : { body }, { headers: who.headers })
  if (!data) throw new Error(`post failed: ${JSON.stringify(error?.value)}`)
  return data
}
const list = async () => (await comments().get({ headers: ana.headers })).data ?? []
const remove = (who: { headers: Record<string, string> }, id: string) => ctx.api.api.comments({ id }).delete(undefined, { headers: who.headers })

describe("comment threads", () => {
  test("a reply files under its comment; replying to a reply files under the same root", async () => {
    const a = await post(ana, "Root")
    const b = await post(budi, "First reply", a.id)
    const c = await post(ana, "Reply to the reply", b.id)
    expect(c.parentId).toBe(a.id)
    const threads = await list()
    expect(threads.map((thread) => thread.id)).toEqual([a.id])
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual([b.id, c.id])
    expect(threads[0]?.replies.every((reply) => reply.parentId === a.id)).toBe(true)
  })

  test("threads are newest first by their first comment; a new reply does not move a thread", async () => {
    const a = await post(ana, "Older")
    const d = await post(budi, "Newer")
    await post(budi, "Late reply to the older one", a.id)
    expect((await list()).map((thread) => thread.id)).toEqual([d.id, a.id])
  })

  test("replyTo must be a comment on the same report", async () => {
    const project = await createProject(ctx.db)
    const other = await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id })
    const elsewhere = (await comments(other.id).post({ body: "Elsewhere" }, { headers: ana.headers })).data?.id ?? ""
    const { error } = await comments().post({ body: "Lost", replyTo: elsewhere }, { headers: ana.headers })
    expect(error?.value).toMatchObject({ code: "comment_not_found" })
  })

  test("deleting a comment with replies keeps a placeholder with no body, author or reactions", async () => {
    const a = await post(ana, "Secret root text")
    const b = await post(budi, "Reply", a.id)
    expect((await remove(ana, a.id)).error).toBeNull()
    const [thread] = await list()
    expect(thread).toMatchObject({ id: a.id, deleted: true, body: "", author: null, mentions: [], reactions: [], viaAgent: null })
    expect(thread?.replies.map((reply) => reply.id)).toEqual([b.id])
    const [row] = await ctx.db.select().from(comment).where(eq(comment.id, a.id))
    expect(row?.body).toBe("")
    expect(row?.deletedAt).not.toBeNull()
  })

  test("deleting the last reply under a placeholder removes the placeholder", async () => {
    const a = await post(ana, "Root")
    const b = await post(budi, "Reply one", a.id)
    const c = await post(budi, "Reply two", a.id)
    await remove(ana, a.id)
    await remove(budi, b.id)
    expect((await list()).map((thread) => thread.id)).toEqual([a.id])
    await remove(budi, c.id)
    expect(await list()).toEqual([])
    expect(await ctx.db.select().from(comment).where(eq(comment.id, a.id))).toHaveLength(0)
  })

  test("a placeholder cannot be edited, but its thread still takes replies", async () => {
    const a = await post(ana, "Root")
    await post(budi, "Reply", a.id)
    await remove(ana, a.id)
    const edited = await ctx.api.api.comments({ id: a.id }).patch({ body: "Back again" }, { headers: ana.headers })
    expect(edited.error?.value).toMatchObject({ code: "comment_not_found" })
    const late = await post(budi, "Still talking", a.id)
    expect(late.parentId).toBe(a.id)
  })

  test("edited shows only after an edit", async () => {
    const a = await post(ana, "Draft")
    expect(a.edited).toBe(false)
    await Bun.sleep(1100)
    const { data } = await ctx.api.api.comments({ id: a.id }).patch({ body: "Final" }, { headers: ana.headers })
    expect(data?.edited).toBe(true)
    expect((await list())[0]?.edited).toBe(true)
  })
})
