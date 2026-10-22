import { beforeEach, describe, expect, test } from "bun:test"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const body = { name: "Checkout", slug: "checkout", urlPatterns: ["*.shop.kantor.test/*"] }

describe("projects", () => {
  test("members list projects but cannot create them", async () => {
    const { headers } = await createUserWithToken(ctx.db)
    await createProject(ctx.db, { name: "Web" })
    const { data } = await ctx.api.api.projects.get({ headers })
    expect(data?.map((p) => p.name)).toEqual(["Web"])
    const { error } = await ctx.api.api.projects.post(body, { headers })
    expect(error?.status as number | undefined).toBe(403)
  })

  test("admins create, rename and delete projects", async () => {
    const { headers } = await createUserWithToken(ctx.db, { role: "admin" })
    const { data: created } = await ctx.api.api.projects.post(body, { headers })
    expect(created).toMatchObject(body)

    const { data: renamed } = await ctx.api.api.projects({ id: created?.id ?? "" }).patch({ name: "Shop" }, { headers })
    expect(renamed?.name).toBe("Shop")

    const { data: deleted } = await ctx.api.api.projects({ id: created?.id ?? "" }).delete(undefined, { headers })
    expect(deleted).toEqual({ ok: true })
  })

  test("slugs are unique and validated", async () => {
    const { headers } = await createUserWithToken(ctx.db, { role: "admin" })
    const other = await createProject(ctx.db, { slug: "taken" })
    expect((await ctx.api.api.projects.post({ ...body, slug: "taken" }, { headers })).error?.status as number | undefined).toBe(409)
    expect((await ctx.api.api.projects.post({ ...body, slug: "Bad Slug" }, { headers })).error?.status as number | undefined).toBe(422)
    const mine = await createProject(ctx.db, { slug: "mine" })
    const { error } = await ctx.api.api.projects({ id: mine.id }).patch({ slug: other.slug }, { headers })
    expect(error?.value).toMatchObject({ code: "slug_taken" })
  })

  test("empty updates are rejected", async () => {
    const { headers } = await createUserWithToken(ctx.db, { role: "admin" })
    const target = await createProject(ctx.db)
    const { error } = await ctx.api.api.projects({ id: target.id }).patch({}, { headers })
    expect(error?.value).toMatchObject({ code: "empty_update" })
  })

  test("projects with reports cannot be deleted", async () => {
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const target = await createProject(ctx.db)
    await createReadyReport(ctx.db, { projectId: target.id, reporterId: admin.user.id })
    const { error } = await ctx.api.api.projects({ id: target.id }).delete(undefined, { headers: admin.headers })
    expect(error?.status as number | undefined).toBe(409)
    expect(error?.value).toMatchObject({ code: "project_has_reports" })
  })

  test("the overview counts each project's reports and lists the pages no pattern catches", async () => {
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const shop = await createProject(ctx.db, { name: "Shop", urlPatterns: ["shop.kantor.test/*"] })
    const docs = await createProject(ctx.db, { name: "Docs", slug: "docs", urlPatterns: [] })
    const reporterId = admin.user.id
    await createReadyReport(ctx.db, { projectId: shop.id, reporterId, pageUrl: "https://shop.kantor.test/cart" })
    await createReadyReport(ctx.db, { projectId: shop.id, reporterId, pageUrl: "https://shop.kantor.test/pay", status: "resolved" })
    await createReadyReport(ctx.db, { projectId: docs.id, reporterId, pageUrl: "https://docs.kantor.test/start?x=1" })
    await createReadyReport(ctx.db, { projectId: docs.id, reporterId, pageUrl: "https://docs.kantor.test/start/" })
    await createReadyReport(ctx.db, { projectId: shop.id, reporterId, pageUrl: "https://docs.kantor.test/start" })
    await createReadyReport(ctx.db, { projectId: shop.id, reporterId, pageUrl: "https://shop.kantor.test/x", uploadStatus: "uploading" })

    const { data } = await ctx.api.api.projects.overview.get({ headers: admin.headers })
    const byProject = Object.fromEntries((data?.stats ?? []).map((row) => [row.projectId, row]))
    expect(byProject[shop.id]).toMatchObject({ reports: 3, open: 2 })
    expect(byProject[docs.id]).toMatchObject({ reports: 2, open: 2 })
    expect(data?.unmatched).toEqual([
      { page: "docs.kantor.test/start", reports: 3, lastReportAt: expect.any(Date), suggestedProjectId: docs.id },
    ])
  })

  test("members can't see the overview", async () => {
    const { headers } = await createUserWithToken(ctx.db)
    const { error } = await ctx.api.api.projects.overview.get({ headers })
    expect(error?.status as number | undefined).toBe(403)
  })
})
