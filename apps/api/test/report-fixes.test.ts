import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { comment, notification, report, reportActivity, reportFix, workspaceMember } from "../src/db/schema"
import type { AppDeps } from "../src/deps"
import type { EmailMessage } from "../src/lib/email/sender"
import { createCommentsService } from "../src/modules/comments/service"
import { addFix, removeFix, resolveReport } from "../src/modules/reports/fixes"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let cici: Awaited<ReturnType<typeof createUserWithToken>>
let reportId: string
let shareSlug: string
let sent: EmailMessage[]
let tasks: Promise<unknown>[]
/** setupTestApp hands email and background to the app only; services called directly need them too. */
let deps: AppDeps

const PR = "https://github.com/shop/web/pull/42"

beforeEach(async () => {
  sent = []
  tasks = []
  const email = {
    async send(message: EmailMessage) {
      sent.push(message)
    },
  }
  const background = (task: Promise<unknown>) => {
    tasks.push(task)
  }
  ctx = await setupTestApp({}, { background, email })
  deps = { ...ctx, email, background }
  ana = await createUserWithToken(ctx.db, { name: "Ana", email: "ana@kantor.test" })
  budi = await createUserWithToken(ctx.db, { name: "Budi", email: "budi@kantor.test" })
  cici = await createUserWithToken(ctx.db, { name: "Cici", email: "cici@kantor.test" })
  const created = await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Pay button fails", visibility: "public" })
  reportId = created.id
  shareSlug = created.shareSlug
})

const notesFor = (userId: string) => ctx.db.select().from(notification).where(eq(notification.userId, userId))
const activityOf = (kind: "status" | "fix") =>
  ctx.db.select().from(reportActivity).where(and(eq(reportActivity.reportId, reportId), eq(reportActivity.kind, kind)))
const fixesOf = () => ctx.db.select().from(reportFix).where(eq(reportFix.reportId, reportId))
const status = async () => (await ctx.db.select({ status: report.status }).from(report).where(eq(report.id, reportId)))[0]?.status

describe("addFix / removeFix", () => {
  test("adds once, labels it, records activity, and removes", async () => {
    const first = await addFix(deps, budi.user, reportId, PR)
    expect(first).toMatchObject([{ url: PR, label: "PR #42 · shop/web", provider: "github", addedById: budi.user.id }])
    expect(await addFix(deps, budi.user, reportId, ` ${PR} `)).toHaveLength(1)
    expect(await activityOf("fix")).toHaveLength(1)
    expect(await removeFix(deps, budi.user, reportId, first[0]?.id ?? "")).toEqual([])
    expect((await activityOf("fix")).map((row) => row.detail).sort((a, b) => String(a.action).localeCompare(String(b.action)))).toEqual([
      { action: "added", url: PR },
      { action: "removed", url: PR },
    ])
  })

  test("rejects non-http URLs, overlong URLs and the 11th link", async () => {
    await expect(addFix(deps, budi.user, reportId, "javascript:alert(1)")).rejects.toMatchObject({ status: 422, code: "fix_url_invalid" })
    await expect(addFix(deps, budi.user, reportId, `https://x.test/${"a".repeat(2000)}`)).rejects.toMatchObject({ status: 422 })
    for (let n = 0; n < 10; n++) await addFix(deps, budi.user, reportId, `https://x.test/${n}`)
    await expect(addFix(deps, budi.user, reportId, "https://x.test/10")).rejects.toMatchObject({ status: 422, code: "fix_limit" })
  })

  test("removing an unknown link is not found", async () => {
    await expect(removeFix(deps, budi.user, reportId, "nope")).rejects.toMatchObject({ status: 404, code: "fix_not_found" })
  })

  test("a non-member gets report_not_found", async () => {
    const dewi = await createUserWithToken(ctx.db, { name: "Dewi", workspaceId: null })
    await expect(addFix(deps, dewi.user, reportId, PR)).rejects.toMatchObject({ status: 404, code: "report_not_found" })
  })
})

describe("resolveReport", () => {
  test("sets resolved, adds links, notifies the reporter once in the bell and by email", async () => {
    const result = await resolveReport(deps, budi.user, reportId, { links: [PR], note: "Stock check fixed" }, { viaAgent: "Claude Code" })
    expect(result).toMatchObject({ notified: true, links: [{ label: "PR #42 · shop/web" }], detail: { status: "resolved" } })
    expect((await activityOf("status")).map((row) => row.detail)).toEqual([{ from: "open", to: "resolved" }])
    expect(await notesFor(ana.user.id)).toMatchObject([{ kind: "resolved", commentId: null, actorId: budi.user.id, reportId }])
    const [note] = await ctx.db.select().from(comment).where(eq(comment.reportId, reportId))
    expect(note).toMatchObject({ body: "Stock check fixed", viaAgent: "Claude Code", authorId: budi.user.id })
    await Promise.all(tasks)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: "ana@kantor.test", subject: expect.stringMatching(/^BB-\d+ is resolved: Pay button fails$/) })
    expect(sent[0]?.text).toContain("Budi (via Claude Code) resolved")
    expect(sent[0]?.text).toContain("Stock check fixed")
  })

  test("the reporter resolving their own report is not notified", async () => {
    expect((await resolveReport(deps, ana.user, reportId, { links: [PR] })).notified).toBe(false)
    expect(await status()).toBe("resolved")
    expect(await notesFor(ana.user.id)).toHaveLength(0)
  })

  test("a reporter who left the workspace is not notified", async () => {
    await ctx.db.delete(workspaceMember).where(eq(workspaceMember.userId, ana.user.id))
    expect((await resolveReport(deps, budi.user, reportId, { links: [PR] })).notified).toBe(false)
    expect(await notesFor(ana.user.id)).toHaveLength(0)
  })

  test("an already-resolved report only gains links: no activity, no notification", async () => {
    await resolveReport(deps, budi.user, reportId, { links: [PR] })
    const again = await resolveReport(deps, cici.user, reportId, { links: ["https://x.test/commit/abc"] })
    expect(again.notified).toBe(false)
    expect(again.links).toHaveLength(2)
    expect(await activityOf("status")).toHaveLength(1)
    expect(await notesFor(ana.user.id)).toHaveLength(1)
  })

  test("two concurrent calls notify once", async () => {
    await Promise.all([
      resolveReport(deps, budi.user, reportId, { links: [PR] }),
      resolveReport(deps, cici.user, reportId, { links: ["https://x.test/commit/abc"] }),
    ])
    expect(await notesFor(ana.user.id)).toHaveLength(1)
    expect(await activityOf("status")).toHaveLength(1)
    expect(await fixesOf()).toHaveLength(2)
  })

  test("a note that mentions the reporter gives them one notification, not two", async () => {
    await resolveReport(deps, budi.user, reportId, { links: [PR], note: `@[user:${ana.user.id}] @[user:${cici.user.id}] done` })
    expect((await notesFor(ana.user.id)).map((row) => row.kind)).toEqual(["resolved"])
    expect((await notesFor(cici.user.id)).map((row) => row.kind)).toEqual(["mention"])
    await Promise.all(tasks)
    expect(sent.map((mail) => mail.to).sort()).toEqual(["ana@kantor.test", "cici@kantor.test"])
  })

  test("a note that mentions a reporter who isn't told of the resolution still reaches them as a mention", async () => {
    await resolveReport(deps, budi.user, reportId, { links: [PR] })
    await resolveReport(deps, budi.user, reportId, { links: ["https://x.test/c/2"], note: `@[user:${ana.user.id}] one more` })
    expect((await notesFor(ana.user.id)).map((row) => row.kind).sort()).toEqual(["mention", "resolved"])
  })

  test("deleting the note keeps the resolved notification", async () => {
    await resolveReport(deps, budi.user, reportId, { links: [PR], note: "done" })
    const [note] = await ctx.db.select().from(comment).where(eq(comment.reportId, reportId))
    await createCommentsService(deps).remove(budi.user, note?.id ?? "")
    expect(await notesFor(ana.user.id)).toHaveLength(1)
  })

  test("a bad link leaves the report untouched", async () => {
    await expect(resolveReport(deps, budi.user, reportId, { links: [PR, "ftp://x"] })).rejects.toMatchObject({ status: 422 })
    expect(await status()).toBe("open")
    expect(await fixesOf()).toHaveLength(0)
  })

  test("the status dropdown does not notify", async () => {
    await ctx.api.api.reports({ id: reportId }).patch({ status: "resolved" }, { headers: budi.headers })
    expect(await status()).toBe("resolved")
    expect(await notesFor(ana.user.id)).toHaveLength(0)
  })
})

describe("who sees Fixed in", () => {
  test("members get fixes in the report detail; the share page does not", async () => {
    await addFix(deps, budi.user, reportId, PR)
    const mine = await ctx.api.api.reports({ id: reportId }).get({ headers: budi.headers })
    expect(mine.data?.fixes).toMatchObject([{ label: "PR #42 · shop/web", provider: "github", url: PR }])
    const outsider = await createUserWithToken(ctx.db, { email: "x@elsewhere.test", workspaceId: null })
    const shared = await ctx.api.api.share({ slug: shareSlug }).get({ headers: outsider.headers })
    expect(shared.status).toBe(200)
    expect(shared.data).not.toHaveProperty("fixes")
  })
})

describe("REST", () => {
  const reportApi = () => ctx.api.api.reports({ id: reportId })

  test("add and remove a fix link", async () => {
    const added = await reportApi().fixes.post({ url: PR }, { headers: budi.headers })
    expect(added.data).toMatchObject([{ label: "PR #42 · shop/web" }])
    const bad = await reportApi().fixes.post({ url: "javascript:x" }, { headers: budi.headers })
    expect(bad.status).toBe(422)
    const removed = await reportApi().fixes({ fixId: added.data?.[0]?.id ?? "" }).delete(undefined, { headers: budi.headers })
    expect(removed.data).toEqual([])
  })

  test("resolve with links and a note", async () => {
    const result = await reportApi().resolve.post({ links: [PR], note: "Fixed" }, { headers: budi.headers })
    expect(result.data).toMatchObject({ notified: true, links: [{ url: PR }], detail: { status: "resolved", fixes: [{ url: PR }] } })
    expect((await reportApi().resolve.post({ links: [] }, { headers: budi.headers })).status).toBe(422)
  })

  test("an outsider can't touch fix links", async () => {
    const outsider = await createUserWithToken(ctx.db, { email: "x@elsewhere.test", workspaceId: null })
    expect([403, 404]).toContain((await reportApi().fixes.post({ url: PR }, { headers: outsider.headers })).status)
    expect([403, 404]).toContain((await reportApi().resolve.post({ links: [PR] }, { headers: outsider.headers })).status)
    expect(await fixesOf()).toHaveLength(0)
    expect(await status()).toBe("open")
  })
})

