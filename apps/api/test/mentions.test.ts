import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { notification } from "../src/db/schema"
import { mentionedIds } from "../src/modules/comments/mentions"
import { createProject, createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let citra: Awaited<ReturnType<typeof createUserWithToken>>
let reportId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana" })
  budi = await createUserWithToken(ctx.db, { name: "Budi" })
  citra = await createUserWithToken(ctx.db, { name: "Citra" })
  const project = await createProject(ctx.db)
  reportId = (await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id })).id
})

const tag = (id: string) => `@[user:${id}]`
const post = (body: string) => ctx.api.api.reports({ id: reportId }).comments.post({ body }, { headers: ana.headers })
const edit = (id: string, body: string) => ctx.api.api.comments({ id }).patch({ body }, { headers: ana.headers })
const notified = async (commentId: string) =>
  (await ctx.db.select({ userId: notification.userId }).from(notification).where(eq(notification.commentId, commentId)))
    .map((row) => row.userId)
    .sort()

describe("mentionedIds", () => {
  test("reads each tagged id once, in order", () => {
    expect(mentionedIds("hi @[user:a] and @[user:b] and @[user:a]")).toEqual(["a", "b"])
    expect(mentionedIds("mail me@[user] or @[user:] plain")).toEqual([])
  })
})

describe("mention notifications", () => {
  test("only workspace members other than the author are notified", async () => {
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const outsider = await createUserWithToken(ctx.db, { name: "Outsider", workspaceId: elsewhere.id })
    const { data } = await post(`${tag(budi.user.id)} ${tag(outsider.user.id)} ${tag(ana.user.id)} ${tag("nobody")} cek`)
    expect(await notified(data?.id ?? "")).toEqual([budi.user.id])
  })

  test("one comment mentioning someone twice notifies them once", async () => {
    const { data } = await post(`${tag(budi.user.id)} lalu ${tag(budi.user.id)} lagi`)
    expect(await notified(data?.id ?? "")).toEqual([budi.user.id])
  })

  test("edits notify only people never notified for this comment", async () => {
    const id = (await post(`${tag(budi.user.id)} cek`)).data?.id ?? ""
    expect(await notified(id)).toEqual([budi.user.id])
    const [first] = await ctx.db.select().from(notification).where(eq(notification.userId, budi.user.id))

    await edit(id, `${tag(budi.user.id)} dan ${tag(citra.user.id)} cek`)
    expect(await notified(id)).toEqual([budi.user.id, citra.user.id].sort())
    await edit(id, `${tag(budi.user.id)} dan ${tag(citra.user.id)} cek lagi`)
    await edit(id, `${tag(citra.user.id)} saja`)
    expect(await notified(id)).toEqual([budi.user.id, citra.user.id].sort())

    const [still] = await ctx.db.select().from(notification).where(eq(notification.userId, budi.user.id))
    expect(still?.id).toBe(first?.id ?? "")
  })

  test("deleting a comment deletes its notifications", async () => {
    const id = (await post(`${tag(budi.user.id)} cek`)).data?.id ?? ""
    await ctx.api.api.comments({ id }).delete(undefined, { headers: ana.headers })
    expect(await notified(id)).toEqual([])
  })

  test("comments come back with the names of the people they mention", async () => {
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const outsider = await createUserWithToken(ctx.db, { name: "Outsider", workspaceId: elsewhere.id })
    const created = await post(`${tag(budi.user.id)} ${tag(outsider.user.id)}`)
    expect(created.data?.mentions).toEqual([{ id: budi.user.id, name: "Budi" }])

    const edited = await edit(created.data?.id ?? "", `${tag(citra.user.id)} ${tag(budi.user.id)}`)
    expect(edited.data?.mentions).toEqual([
      { id: citra.user.id, name: "Citra" },
      { id: budi.user.id, name: "Budi" },
    ])

    const { data } = await ctx.api.api.reports({ id: reportId }).comments.get({ headers: budi.headers })
    expect(data?.[0]?.mentions).toEqual([
      { id: citra.user.id, name: "Citra" },
      { id: budi.user.id, name: "Budi" },
    ])
  })
})
