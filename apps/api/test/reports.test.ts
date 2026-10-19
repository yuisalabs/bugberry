import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import { LocalStorageDriver } from "../src/storage/local"
import { createProject, createReadyReport, createUser, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  member = await createUserWithToken(ctx.db, { name: "Ana" })
  projectId = (await createProject(ctx.db)).id
})

const make = (overrides: Partial<Parameters<typeof createReadyReport>[1]> = {}) =>
  createReadyReport(ctx.db, { projectId, reporterId: member.user.id, ...overrides })

describe("GET /api/reports", () => {
  test("lists only finished uploads, newest first", async () => {
    await make({ title: "old", createdAt: new Date("2026-01-01") })
    await make({ title: "new", createdAt: new Date("2026-02-01") })
    await make({ title: "still uploading", uploadStatus: "uploading" })
    const { data } = await ctx.api.api.reports.get({ headers: member.headers })
    expect(data?.items.map((r) => r.title)).toEqual(["new", "old"])
    expect(data?.total).toBe(2)
    expect(data?.items[0]?.reporter).toEqual({ id: member.user.id, name: "Ana", image: null })
    expect(data?.items.map((item) => typeof item.number)).toEqual(data?.items.map(() => "number"))
  })

  test("filters by several statuses and by project", async () => {
    const other = await createProject(ctx.db)
    await make({ title: "open", status: "open" })
    await make({ title: "closed", status: "closed" })
    await make({ title: "resolved", status: "resolved" })
    await createReadyReport(ctx.db, { projectId: other.id, reporterId: member.user.id, title: "elsewhere" })
    const { data } = await ctx.api.api.reports.get({
      query: { projectId, status: ["open", "closed"] },
      headers: member.headers,
    })
    expect(data?.items.map((r) => r.title).sort()).toEqual(["closed", "open"])
  })

  test("treats % and _ in the search text literally", async () => {
    await make({ title: "100% broken" })
    await make({ title: "fully broken" })
    await make({ title: "snake_case field" })
    const percent = await ctx.api.api.reports.get({ query: { q: "%" }, headers: member.headers })
    expect(percent.data?.items.map((r) => r.title)).toEqual(["100% broken"])
    const underscore = await ctx.api.api.reports.get({ query: { q: "_" }, headers: member.headers })
    expect(underscore.data?.items.map((r) => r.title)).toEqual(["snake_case field"])
  })

  test("sorts by priority and paginates", async () => {
    await make({ title: "low", priority: "low" })
    await make({ title: "critical", priority: "critical" })
    await make({ title: "medium", priority: "medium" })
    const { data } = await ctx.api.api.reports.get({
      query: { sort: "priority", page: 2, perPage: 1 },
      headers: member.headers,
    })
    expect(data?.items.map((r) => r.title)).toEqual(["medium"])
    expect(data).toMatchObject({ page: 2, perPage: 1, total: 3 })
  })

  test("sorts oldest first", async () => {
    await make({ title: "first" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await make({ title: "second" })
    const { data } = await ctx.api.api.reports.get({ query: { sort: "oldest" }, headers: member.headers })
    expect(data?.items.map((r) => r.title)).toEqual(["first", "second"])
  })

  test("page and perPage must be reasonable whole numbers", async () => {
    for (const query of ["page=1.5", "page=1e20", "page=100001", "perPage=2.5"]) {
      const response = await ctx.app.handle(
        new Request(`http://localhost/api/reports?${query}`, { headers: member.headers }),
      )
      expect({ query, status: response.status }).toEqual({ query, status: 422 })
    }
  })
})

describe("report list for cards", () => {
  test("list items carry duration and a thumbnail link, falling back to the screenshot itself", async () => {
    const shot = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    const oldVideo = await createReadyReport(ctx.db, {
      projectId, reporterId: member.user.id, captureType: "video", mediaType: "video/webm", durationMs: 12_000,
    })
    const newVideo = await createReadyReport(ctx.db, {
      projectId, reporterId: member.user.id, captureType: "video", mediaType: "video/webm", durationMs: 3_000,
    })
    await ctx.db
      .update(report)
      .set({ thumbnailKey: `reports/${newVideo.id}/thumbnail.jpg`, thumbnailSize: 3 })
      .where(eq(report.id, newVideo.id))
    const { data } = await ctx.api.api.reports.get({ query: {}, headers: member.headers })
    const byId = new Map(data?.items.map((item) => [item.id, item]))
    expect(byId.get(shot.id)?.thumbnailUrl).toContain("/api/files/")
    expect(byId.get(oldVideo.id)).toMatchObject({ durationMs: 12_000, thumbnailUrl: null })
    expect(byId.get(newVideo.id)?.thumbnailUrl).toContain("/api/files/")
    expect(byId.get(newVideo.id)?.thumbnailUrl).not.toBe(byId.get(shot.id)?.thumbnailUrl)
    expect(byId.get(shot.id)).not.toHaveProperty("mediaKey")
    expect(byId.get(newVideo.id)).not.toHaveProperty("thumbnailKey")
  })

  test("list items carry the share link, so a card can copy it", async () => {
    const shot = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    const [stored] = await ctx.db.select({ shareSlug: report.shareSlug }).from(report).where(eq(report.id, shot.id))
    const { data } = await ctx.api.api.reports.get({ query: {}, headers: member.headers })
    const item = data?.items.find((entry) => entry.id === shot.id)
    expect(item?.shareSlug).toBe(stored?.shareSlug)
    expect(item).toHaveProperty("internalDomain")
    expect(item).not.toHaveProperty("reporterDomain")
  })

  test("filters by capture type", async () => {
    await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    const video = await createReadyReport(ctx.db, {
      projectId, reporterId: member.user.id, captureType: "video", mediaType: "video/webm", durationMs: 1000,
    })
    const { data } = await ctx.api.api.reports.get({ query: { captureType: "video" }, headers: member.headers })
    expect(data?.items.map((item) => item.id)).toEqual([video.id])
  })
})

describe("thumbnails that arrive late", () => {
  test("deleting a report also removes a thumbnail it no longer references", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
    const late = `reports/${created.id}/thumbnail.jpg`
    await ctx.storage.writeObject(late, new Uint8Array([1]))
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    await ctx.api.api.reports({ id: created.id }).delete(undefined, { headers: admin.headers })
    expect(await ctx.storage.head(late)).toBeNull()
  })
})

describe("reports without a project", () => {
  test("filters reports without a project with projectId=none", async () => {
    const inProject = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    const loose = await createReadyReport(ctx.db, { projectId: null, reporterId: member.user.id })
    const all = await ctx.api.api.reports.get({ query: {}, headers: member.headers })
    expect(all.data?.items.map((item) => item.id).sort()).toEqual([inProject.id, loose.id].sort())
    const none = await ctx.api.api.reports.get({ query: { projectId: "none" }, headers: member.headers })
    expect(none.data?.items.map((item) => item.id)).toEqual([loose.id])
    expect(none.data?.items[0]?.projectId).toBeNull()
  })

  test("PATCH moves a report into a project, to another one, and back out", async () => {
    const other = await createProject(ctx.db, { name: "Other", slug: "other" })
    const created = await createReadyReport(ctx.db, { projectId: null, reporterId: member.user.id })
    const patch = (target: string | null) =>
      ctx.api.api.reports({ id: created.id }).patch({ projectId: target }, { headers: member.headers })
    expect((await patch(projectId)).data?.projectId).toBe(projectId)
    expect((await patch(other.id)).data?.projectId).toBe(other.id)
    expect((await patch(null)).data?.projectId).toBeNull()
    expect((await patch("missing")).error?.value).toMatchObject({ code: "project_not_found" })
  })
})

describe("single report", () => {
  test("detail includes readable file links", async () => {
    const created = await make({ debuggerKey: "reports/x/debugger.json.gz", debuggerSize: 2 })
    const { data } = await ctx.api.api.reports({ id: created.id }).get({ headers: member.headers })
    expect(data?.mediaUrl).toContain("/api/files/")
    expect(data?.debuggerUrl).toContain("/api/files/")
    expect(data?.assignee).toBeNull()
    expect(data).not.toHaveProperty("mediaKey")
  })

  test("members update status, priority and assignee", async () => {
    const created = await make()
    const assignee = await createUser(ctx.db, { name: "Budi" })
    const { data } = await ctx.api.api.reports({ id: created.id }).patch(
      { status: "in_progress", priority: "high", assigneeId: assignee.id },
      { headers: member.headers },
    )
    expect(data).toMatchObject({ status: "in_progress", priority: "high", assignee: { id: assignee.id, name: "Budi" } })

    const cleared = await ctx.api.api.reports({ id: created.id }).patch({ assigneeId: null }, { headers: member.headers })
    expect(cleared.data?.assignee).toBeNull()
  })

  test("a partial update leaves the other fields untouched", async () => {
    const created = await make({ status: "resolved", priority: "high", visibility: "public" })
    const { data } = await ctx.api.api.reports({ id: created.id }).patch({ title: "Renamed" }, { headers: member.headers })
    expect(data).toMatchObject({ title: "Renamed", status: "resolved", priority: "high", visibility: "public" })
  })

  test("rejects unknown assignees and empty updates", async () => {
    const created = await make()
    const badAssignee = await ctx.api.api.reports({ id: created.id }).patch({ assigneeId: "missing" }, { headers: member.headers })
    expect(badAssignee.error?.value).toMatchObject({ code: "assignee_not_found" })
    const empty = await ctx.api.api.reports({ id: created.id }).patch({}, { headers: member.headers })
    expect(empty.error?.value).toMatchObject({ code: "empty_update" })
  })

  test("an empty assigneeId is a validation error, not a server error", async () => {
    const created = await make()
    const { error } = await ctx.api.api.reports({ id: created.id }).patch({ assigneeId: "" }, { headers: member.headers })
    expect(error?.status as number | undefined).toBe(422)
  })

  test("unknown reports return 404", async () => {
    const { error } = await ctx.api.api.reports({ id: "missing" }).get({ headers: member.headers })
    expect(error?.status as number | undefined).toBe(404)
  })

  test("only admins delete, and deleting removes the files", async () => {
    const created = await make()
    if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
    await ctx.storage.writeObject(created.mediaKey, new Uint8Array([1, 2, 3]))
    const thumbnailKey = `reports/${created.id}/thumbnail.jpg`
    await ctx.db.update(report).set({ thumbnailKey, thumbnailSize: 1 }).where(eq(report.id, created.id))
    await ctx.storage.writeObject(thumbnailKey, new Uint8Array([4]))

    const asMember = await ctx.api.api.reports({ id: created.id }).delete(undefined, { headers: member.headers })
    expect(asMember.error?.status as number | undefined).toBe(403)

    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const { data } = await ctx.api.api.reports({ id: created.id }).delete(undefined, { headers: admin.headers })
    expect(data).toEqual({ ok: true })
    expect(await ctx.storage.head(created.mediaKey)).toBeNull()
    expect(await ctx.storage.head(thumbnailKey)).toBeNull()
    const after = await ctx.api.api.reports({ id: created.id }).get({ headers: member.headers })
    expect(after.error?.status as number | undefined).toBe(404)
  })
})
