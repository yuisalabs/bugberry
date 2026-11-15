import { beforeEach, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { comment, report } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { LocalStorageDriver } from "../src/storage/local"
import { createProject, createReadyReport, createUser, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

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

const day = (n: number) => new Date(`2026-01-0${n}T00:00:00Z`)
const listPage = (query: Record<string, unknown>) => ctx.api.api.reports.get({ query, headers: member.headers })

/** The titles of the whole list, read a page at a time by following `nextCursor`. */
async function walk(query: Record<string, unknown>) {
  const titles: string[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 50; guard++) {
    const { data, status } = await listPage({ ...query, ...(cursor ? { cursor } : {}) })
    expect(status).toBe(200)
    titles.push(...(data?.items.map((r) => r.title) ?? []))
    if (!data?.nextCursor) return titles
    cursor = data.nextCursor
  }
  throw new Error("the list never ended")
}

describe("GET /api/reports", () => {
  test("q matches description and comment text", async () => {
    await make({ title: "Checkout", description: "Only on Safari 17" })
    const commented = await make({ title: "Login" })
    await ctx.db.insert(comment).values({ id: newId(), reportId: commented.id, authorId: member.user.id, body: "Also broken in safari" })
    await make({ title: "Unrelated" })
    const { data } = await ctx.api.api.reports.get({ query: { q: "Safari" }, headers: member.headers })
    expect(data?.items.map((r) => r.title).sort()).toEqual(["Checkout", "Login"])
  })

  test("createdAfter and createdBefore bound the list", async () => {
    await make({ title: "jan", createdAt: new Date("2026-01-15T00:00:00Z") })
    await make({ title: "feb", createdAt: new Date("2026-02-15T00:00:00Z") })
    await make({ title: "mar", createdAt: new Date("2026-03-15T00:00:00Z") })
    const { data } = await ctx.api.api.reports.get({
      query: { createdAfter: "2026-02-01T00:00:00Z", createdBefore: "2026-03-01T00:00:00Z" },
      headers: member.headers,
    })
    expect(data?.items.map((r) => r.title)).toEqual(["feb"])
  })

  test("assigneeId none keeps unassigned reports", async () => {
    await make({ title: "taken", assigneeId: member.user.id })
    await make({ title: "free" })
    const { data } = await ctx.api.api.reports.get({ query: { assigneeId: "none" }, headers: member.headers })
    expect(data?.items.map((r) => r.title)).toEqual(["free"])
  })

  test("hasErrors keeps reports with errors or failed requests", async () => {
    const summary = { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] }
    await make({ title: "errors", debuggerSummary: { ...summary, errors: 1 } })
    await make({ title: "failed", debuggerSummary: { ...summary, failedRequests: 2 } })
    await make({ title: "clean", debuggerSummary: summary })
    const { data } = await ctx.api.api.reports.get({ query: { hasErrors: true }, headers: member.headers })
    expect(data?.items.map((r) => r.title).sort()).toEqual(["errors", "failed"])
  })

  test("lists only finished uploads, newest first", async () => {
    await make({ title: "old", createdAt: new Date("2026-01-01") })
    await make({ title: "new", createdAt: new Date("2026-02-01") })
    await make({ title: "still uploading", uploadStatus: "uploading" })
    const { data } = await ctx.api.api.reports.get({ headers: member.headers })
    expect(data?.items.map((r) => r.title)).toEqual(["new", "old"])
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

  test("q finds a term in the title, the URL, the description and a comment, whatever its case", async () => {
    await make({ title: "Zebra crossing" })
    await make({ title: "url", pageUrl: "https://app.kantor.test/zebra/1" })
    await make({ title: "desc", description: "seen near the ZEBRA" })
    const commented = await make({ title: "comment" })
    await ctx.db.insert(comment).values({ id: newId(), reportId: commented.id, authorId: member.user.id, body: "zebra again" })
    await make({ title: "none" })
    const { data } = await ctx.api.api.reports.get({ query: { q: "zEbRa" }, headers: member.headers })
    expect(data?.items.map((r) => r.title).sort()).toEqual(["Zebra crossing", "comment", "desc", "url"])
  })

  test("q of one or two characters still searches", async () => {
    await make({ title: "qz" })
    await make({ title: "xy" })
    for (const q of ["q", "qz"]) {
      const { data } = await ctx.api.api.reports.get({ query: { q }, headers: member.headers })
      expect(data?.items.map((r) => r.title)).toEqual(["qz"])
    }
  })

  test("q treats a backslash as a plain character", async () => {
    await make({ title: "C:\\temp\\log" })
    await make({ title: "C:/temp/log" })
    const { data } = await ctx.api.api.reports.get({ query: { q: "\\temp" }, headers: member.headers })
    expect(data?.items.map((r) => r.title)).toEqual(["C:\\temp\\log"])
  })

  test("q does not reach another workspace's reports or comments", async () => {
    const other = await createWorkspaceRow(ctx.db, "Other")
    const outsider = await createUser(ctx.db, { workspaceId: other.id })
    const theirs = await createReadyReport(ctx.db, { reporterId: outsider.id, workspaceId: other.id, title: "zebra elsewhere" })
    await ctx.db.insert(comment).values({ id: newId(), reportId: theirs.id, authorId: outsider.id, body: "zebra" })
    const { data } = await ctx.api.api.reports.get({ query: { q: "zebra" }, headers: member.headers })
    expect(data?.items).toEqual([])
  })

  test("the status counts follow the same search", async () => {
    await make({ title: "zebra open", status: "open" })
    await make({ title: "zebra closed", status: "closed" })
    await make({ title: "other", status: "open" })
    const { data } = await ctx.api.api.reports.counts.get({ query: { q: "zebra" }, headers: member.headers })
    expect(data).toMatchObject({ total: 2, byStatus: { open: 1, closed: 1 } })
  })

  describe("a search that matches by title in some reports and by comment in others", () => {
    /** Seven matches a day apart: odd days by title, even days by a comment, day 5 by both; day 8 does not match. */
    beforeEach(async () => {
      const says = (reportId: string, body: string) =>
        ctx.db.insert(comment).values({ id: newId(), reportId, authorId: member.user.id, body })
      await make({ title: "zebra 1", createdAt: day(1), priority: "high" })
      await says((await make({ title: "plain 2", createdAt: day(2), priority: "critical" })).id, "a zebra")
      await make({ title: "zebra 3", createdAt: day(3), status: "closed" })
      const twice = await make({ title: "plain 4", createdAt: day(4) })
      await says(twice.id, "zebra")
      await says(twice.id, "zebra, again")
      await says((await make({ title: "zebra 5", createdAt: day(5) })).id, "zebra")
      await says((await make({ title: "plain 6", createdAt: day(6), status: "closed" })).id, "Zebra")
      await make({ title: "zebra 7", createdAt: day(7) })
      await says((await make({ title: "plain 8", createdAt: day(8) })).id, "nothing")
    })

    const titles = async (query: Record<string, unknown>) => {
      const { data } = await ctx.api.api.reports.get({ query: { q: "zebra", ...query }, headers: member.headers })
      return data?.items.map((r) => r.title)
    }

    test("a page holds the newest of both kinds, each report once", async () => {
      expect(await titles({ perPage: 3 })).toEqual(["zebra 7", "plain 6", "zebra 5"])
      expect(await titles({})).toEqual(["zebra 7", "plain 6", "zebra 5", "plain 4", "zebra 3", "plain 2", "zebra 1"])
    })

    test("walking it a page at a time gives each match once, for each sort", async () => {
      const newest = ["zebra 7", "plain 6", "zebra 5", "plain 4", "zebra 3", "plain 2", "zebra 1"]
      expect(await walk({ q: "zebra", perPage: 2 })).toEqual(newest)
      expect(await walk({ q: "zebra", perPage: 2, sort: "oldest" })).toEqual([...newest].reverse())
      expect(await walk({ q: "zebra", perPage: 2, sort: "priority" })).toEqual([
        "plain 2",
        "zebra 1",
        "zebra 7",
        "plain 6",
        "zebra 5",
        "plain 4",
        "zebra 3",
      ])
    })

    test("oldest first and by priority order both kinds together", async () => {
      expect(await titles({ perPage: 3, sort: "oldest" })).toEqual(["zebra 1", "plain 2", "zebra 3"])
      expect(await titles({ perPage: 3, sort: "priority" })).toEqual(["plain 2", "zebra 1", "zebra 7"])
    })

    test("the other filters still narrow it", async () => {
      expect(await titles({ status: ["closed"] })).toEqual(["plain 6", "zebra 3"])
    })

    test("the status counts hold exactly the reports the list shows", async () => {
      const { data } = await ctx.api.api.reports.counts.get({ query: { q: "zebra" }, headers: member.headers })
      expect(data).toMatchObject({ total: 7, byStatus: { open: 5, closed: 2 } })
    })
  })

  test("walking the list gives every report once, in order, for each sort", async () => {
    const priorities = ["none", "low", "low", "medium", "high", "critical", "none"] as const
    for (const [index, priority] of priorities.entries()) await make({ title: `r${index + 1}`, createdAt: day(index + 1), priority })
    const newest = ["r7", "r6", "r5", "r4", "r3", "r2", "r1"]
    expect(await walk({ perPage: 3 })).toEqual(newest)
    expect(await walk({ perPage: 3, sort: "oldest" })).toEqual([...newest].reverse())
    expect(await walk({ perPage: 3, sort: "priority" })).toEqual(["r6", "r5", "r4", "r3", "r2", "r7", "r1"])
  })

  test("reports created a microsecond apart, or in the same one, are each listed once", async () => {
    const at = (micros: number) => sql`${`2026-03-01 00:00:00.00000${micros}+00`}::timestamptz`
    for (const [title, micros] of [["a", 1], ["b", 2], ["c", 3], ["d", 3]] as const) {
      const made = await make({ title })
      await ctx.db.update(report).set({ createdAt: at(micros) }).where(eq(report.id, made.id))
    }
    const newest = await walk({ perPage: 1 })
    expect(newest.slice(2)).toEqual(["b", "a"])
    // c and d share their time, so their ids order them, however the database collates ids.
    expect(newest.slice(0, 2).sort()).toEqual(["c", "d"])
    expect(await walk({ perPage: 1, sort: "oldest" })).toEqual([...newest].reverse())
  })

  test("a list of exactly one page has no next cursor", async () => {
    for (let n = 0; n < 3; n++) await make()
    const { data } = await listPage({ perPage: 3 })
    expect(data?.items).toHaveLength(3)
    expect(data?.nextCursor).toBeNull()
    expect(data).not.toHaveProperty("total")
    expect(data).not.toHaveProperty("page")
    expect(Object.keys(data?.items[0] ?? {}).filter((key) => /cursor|text|position/i.test(key))).toEqual([])
  })

  test("a report that arrives while walking does not repeat or hide another", async () => {
    for (let n = 1; n <= 4; n++) await make({ title: `r${n}`, createdAt: day(n) })
    const first = await listPage({ perPage: 2 })
    expect(first.data?.items.map((r) => r.title)).toEqual(["r4", "r3"])
    await make({ title: "r5", createdAt: day(5) })
    const second = await listPage({ perPage: 2, cursor: first.data?.nextCursor })
    expect(second.data?.items.map((r) => r.title)).toEqual(["r2", "r1"])
    expect(second.data?.nextCursor).toBeNull()
  })

  test("a cursor keeps its place when the filters change", async () => {
    for (const [n, status] of [[1, "closed"], [2, "open"], [3, "closed"], [4, "open"], [5, "open"]] as const) {
      await make({ title: `${status} ${n}`, createdAt: day(n), status })
    }
    const first = await listPage({ perPage: 2 })
    expect(first.data?.items.map((r) => r.title)).toEqual(["open 5", "open 4"])
    const { data, status } = await listPage({ perPage: 2, cursor: first.data?.nextCursor, status: ["closed"] })
    expect(status).toBe(200)
    expect(data?.items.map((r) => r.title)).toEqual(["closed 3", "closed 1"])
  })

  test("a report whose priority changes mid-walk does not break the next page", async () => {
    const made: Record<string, string> = {}
    for (const [n, priority] of [[1, "none"], [2, "low"], [3, "low"], [4, "high"], [5, "critical"]] as const) {
      made[`r${n}`] = (await make({ title: `r${n}`, createdAt: day(n), priority })).id
    }
    const first = await listPage({ perPage: 2, sort: "priority" })
    expect(first.data?.items.map((r) => r.title)).toEqual(["r5", "r4"])
    await ctx.db.update(report).set({ priority: "critical" }).where(eq(report.id, made.r2 ?? ""))
    const { data, status } = await listPage({ perPage: 2, sort: "priority", cursor: first.data?.nextCursor })
    expect(status).toBe(200)
    // r2 moved to before the cursor, so this walk no longer meets it.
    expect(data?.items.map((r) => r.title)).toEqual(["r3", "r1"])
  })

  test("a cursor from another sort, or one that cannot be read, is a 400", async () => {
    await make()
    await make()
    const fromNewest = (await listPage({ perPage: 1 })).data?.nextCursor
    expect(fromNewest).toBeString()
    for (const cursor of [fromNewest, "garbage", Buffer.from("page:2").toString("base64url")]) {
      const response = await ctx.app.handle(new Request(`http://localhost/api/reports?sort=oldest&cursor=${cursor}`, { headers: member.headers }))
      expect({ cursor, status: response.status }).toEqual({ cursor, status: 400 })
      expect(await response.text()).toContain("bad_cursor")
    }
  })

  test("a cursor that reads well but holds odd values is answered, never a server error", async () => {
    await make({ priority: "high" })
    await make()
    const at = "2026-03-01T10:00:00.123456Z"
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
    const cursors: Array<[string, string]> = [
      ["newest", enc({ sort: "newest", createdAt: at, id: "'; DROP TABLE report; --" })],
      ["newest", enc({ sort: "newest", createdAt: at, id: "\ud83d" })],
      ["newest", enc({ sort: "newest", createdAt: at, id: "\u{1f41e}".repeat(50) })],
      ["newest", enc({ sort: "newest", createdAt: at, id: "a\u0001\n\tb" })],
      ["oldest", enc({ sort: "oldest", createdAt: "0001-01-01T00:00:00.000000Z", id: "r1" })],
      ["newest", enc({ sort: "newest", createdAt: "9999-12-31T23:59:59.999999Z", id: "r1" })],
      ["priority", enc({ sort: "priority", createdAt: at, id: "r1", priority: "low" })],
    ]
    for (const [sort, cursor] of cursors) {
      const response = await ctx.app.handle(new Request(`http://localhost/api/reports?sort=${sort}&cursor=${cursor}`, { headers: member.headers }))
      expect({ cursor, status: response.status }).toEqual({ cursor, status: 200 })
      expect(Array.isArray(((await response.json()) as { items: unknown }).items)).toBe(true)
    }
    const { count } = (await ctx.db.execute(sql`select count(*)::int as count from report`))[0] as { count: number }
    expect(count).toBe(2)
  })

  test("the page number of older versions is refused, not answered with the first page again", async () => {
    await make()
    for (const page of [1, 2]) {
      const response = await ctx.app.handle(new Request(`http://localhost/api/reports?page=${page}`, { headers: member.headers }))
      expect({ page, status: response.status }).toEqual({ page, status: 400 })
      expect(await response.text()).toContain("page_removed")
    }
  })

  test("the priority sort runs from critical down to none", async () => {
    for (const priority of ["medium", "none", "critical", "low", "high"] as const) await make({ title: priority, priority })
    const { data } = await ctx.api.api.reports.get({ query: { sort: "priority" }, headers: member.headers })
    expect(data?.items.map((r) => r.title)).toEqual(["critical", "high", "medium", "low", "none"])
  })

  test("sorts oldest first", async () => {
    await make({ title: "first" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await make({ title: "second" })
    const { data } = await ctx.api.api.reports.get({ query: { sort: "oldest" }, headers: member.headers })
    expect(data?.items.map((r) => r.title)).toEqual(["first", "second"])
  })

  test("perPage must be a reasonable whole number, and a cursor a short one", async () => {
    for (const query of ["perPage=2.5", "perPage=0", "perPage=51", `cursor=${"x".repeat(401)}`]) {
      const response = await ctx.app.handle(new Request(`http://localhost/api/reports?${query}`, { headers: member.headers }))
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

  test("deleting a replay removes its frames", async () => {
    const id = newId()
    const created = await make({ id, captureType: "replay", mediaKey: `reports/${id}/media.json.gz`, replayFrames: [0, 5_000] })
    if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
    const frames = [`reports/${id}/frames/000.jpg`, `reports/${id}/frames/001.jpg`]
    for (const key of [created.mediaKey, ...frames]) await ctx.storage.writeObject(key, new Uint8Array([1]))

    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    await ctx.api.api.reports({ id }).delete(undefined, { headers: admin.headers })
    for (const key of [created.mediaKey, ...frames]) expect(await ctx.storage.head(key)).toBeNull()
  })
})

describe("GET /api/reports/counts", () => {
  test("counts each status under the other filters, ignoring the status filter itself", async () => {
    await make({ title: "a", status: "open", captureType: "video" })
    await make({ title: "b", status: "open" })
    await make({ title: "c", status: "in_progress" })
    await make({ title: "d", status: "resolved" })
    await make({ title: "still uploading", status: "open", uploadStatus: "uploading" })

    const { data: all } = await ctx.api.api.reports.counts.get({ query: { status: ["resolved"] }, headers: member.headers })
    expect(all).toEqual({ total: 4, byStatus: { open: 2, in_progress: 1, resolved: 1, closed: 0 } })

    const { data: videos } = await ctx.api.api.reports.counts.get({ query: { captureType: "video" }, headers: member.headers })
    expect(videos).toEqual({ total: 1, byStatus: { open: 1, in_progress: 0, resolved: 0, closed: 0 } })
  })

  test("only the caller's own workspace is counted", async () => {
    await make({ title: "mine" })
    const outsider = await createUserWithToken(ctx.db, { name: "Zed", workspaceId: (await createWorkspaceRow(ctx.db, "Elsewhere")).id })
    const { data } = await ctx.api.api.reports.counts.get({ query: {}, headers: outsider.headers })
    expect(data?.total).toBe(0)
  })
})
