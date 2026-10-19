import { beforeEach, describe, expect, test } from "bun:test"
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
  reportId = (await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id })).id
})

const comments = () => ctx.api.api.reports({ id: reportId }).comments

describe("comments", () => {
  test("members add comments and read them oldest first, with the author", async () => {
    await comments().post({ body: "  Bisa direproduksi di Chrome  " }, { headers: ana.headers })
    await comments().post({ body: "Saya cek" }, { headers: budi.headers })
    const { data } = await comments().get({ headers: ana.headers })
    expect(data?.map((item) => [item.author.name, item.body])).toEqual([
      ["Ana", "Bisa direproduksi di Chrome"],
      ["Budi", "Saya cek"],
    ])
  })

  test("rejects empty and overly long comments", async () => {
    const empty = await comments().post({ body: "   " }, { headers: ana.headers })
    expect(empty.error?.value).toMatchObject({ code: "empty_comment" })
    const long = await comments().post({ body: "x".repeat(5001) }, { headers: ana.headers })
    expect(long.error?.status as number | undefined).toBe(422)
  })

  test("comments need a finished report", async () => {
    const project = await createProject(ctx.db)
    const uploading = await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id, uploadStatus: "uploading" })
    for (const id of ["missing", uploading.id]) {
      const { error } = await ctx.api.api.reports({ id }).comments.get({ headers: ana.headers })
      expect(error?.status as number | undefined).toBe(404)
    }
  })

  test("only the author edits a comment", async () => {
    const { data: created } = await comments().post({ body: "Awal" }, { headers: ana.headers })
    const id = created?.id ?? ""
    const byOther = await ctx.api.api.comments({ id }).patch({ body: "Diubah Budi" }, { headers: budi.headers })
    expect(byOther.error?.status as number | undefined).toBe(403)
    const { data } = await ctx.api.api.comments({ id }).patch({ body: " Diperbarui " }, { headers: ana.headers })
    expect(data?.body).toBe("Diperbarui")
  })

  test("the author or an admin deletes a comment", async () => {
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const first = (await comments().post({ body: "Satu" }, { headers: ana.headers })).data?.id ?? ""
    const second = (await comments().post({ body: "Dua" }, { headers: ana.headers })).data?.id ?? ""

    const byOther = await ctx.api.api.comments({ id: first }).delete(undefined, { headers: budi.headers })
    expect(byOther.error?.status as number | undefined).toBe(403)
    expect((await ctx.api.api.comments({ id: first }).delete(undefined, { headers: ana.headers })).data).toEqual({ ok: true })
    expect((await ctx.api.api.comments({ id: second }).delete(undefined, { headers: admin.headers })).data).toEqual({ ok: true })
    const missing = await ctx.api.api.comments({ id: first }).delete(undefined, { headers: ana.headers })
    expect(missing.error?.status as number | undefined).toBe(404)
  })
})

describe("via AI", () => {
  test("REST comments never carry viaAgent", async () => {
    const created = await comments().post({ body: "x", viaAgent: "Hacker" } as { body: string }, { headers: ana.headers })
    expect(created.data?.viaAgent).toBeNull()
  })

  test("service create stores viaAgent and edits keep it", async () => {
    const service = createCommentsService({ ...ctx, background: undefined })
    const created = await service.create(ana.user, reportId, "Hi", { viaAgent: "Claude Code" })
    expect(created.viaAgent).toBe("Claude Code")
    const { data } = await ctx.api.api.comments({ id: created.id }).patch({ body: "Edited" }, { headers: ana.headers })
    expect(data?.viaAgent).toBe("Claude Code")
    const listed = await comments().get({ headers: ana.headers })
    expect(listed.data?.[0]?.viaAgent).toBe("Claude Code")
  })
})
