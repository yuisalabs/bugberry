import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import type { EmailMessage } from "../src/lib/email/sender"
import { guestFixture, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let f: Awaited<ReturnType<typeof guestFixture>>
let outbox: EmailMessage[]
let pending: Promise<unknown>[]

type Who = { headers: Record<string, string> }
const call = (method: string, path: string, who: Who, body?: unknown) =>
  ctx.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...who.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
const json = async (response: Response) => (await response.json()) as any
const comment = (who: Who, reportId: string, body: string, replyTo?: string) =>
  call("POST", `/api/reports/${reportId}/comments`, who, replyTo ? { body, replyTo } : { body })
const notificationsOf = async (who: Who) => (await json(await call("GET", "/api/notifications", who))).items as Array<{ kind: string }>
const settle = () => Promise.all(pending)

beforeEach(async () => {
  outbox = []
  pending = []
  ctx = await setupTestApp({}, { email: { send: async (message) => void outbox.push(message) }, background: (task) => void pending.push(task) })
  f = await guestFixture(ctx.db)
})

describe("guests in the comments", () => {
  test("a guest reads and writes comments on their project's report", async () => {
    expect((await comment(f.guest, f.reportP1.id, "Still happens on my phone")).status).toBe(200)
    const threads = await json(await call("GET", `/api/reports/${f.reportP1.id}/comments`, f.guest))
    expect(threads.map((thread: { body: string }) => thread.body)).toEqual(["Still happens on my phone"])
    const asMember = await json(await call("GET", `/api/reports/${f.reportP1.id}/comments`, f.member))
    expect(asMember[0].author.name).toBe("Guest")
  })

  test("a guest can't comment on another project's report, or one without a project", async () => {
    for (const id of [f.reportP2.id, f.reportNone.id]) {
      const answer = await comment(f.guest, id, "Hello")
      expect(answer.status).toBe(404)
      expect((await json(answer)).code).toBe("report_not_found")
    }
  })

  test("a guest edits and deletes their own comment, not a member's", async () => {
    const own = await json(await comment(f.guest, f.reportP1.id, "Mine"))
    const theirs = await json(await comment(f.member, f.reportP1.id, "Member's"))
    expect((await call("PATCH", `/api/comments/${own.id}`, f.guest, { body: "Mine, edited" })).status).toBe(200)
    expect((await call("PATCH", `/api/comments/${theirs.id}`, f.guest, { body: "Hijacked" })).status).toBe(403)
    expect((await call("DELETE", `/api/comments/${theirs.id}`, f.guest)).status).toBe(403)
    expect((await call("POST", `/api/comments/${theirs.id}/reactions`, f.guest, { emoji: "👍" })).status).toBe(200)
    expect((await call("DELETE", `/api/comments/${own.id}`, f.guest)).status).toBe(200)
  })

  test("mentionable lists members and this project's guests, without emails", async () => {
    const people = await json(await call("GET", `/api/reports/${f.reportP1.id}/mentionable`, f.member))
    expect(people.map((person: { name: string; guest: boolean }) => [person.name, person.guest])).toEqual([
      ["Admin", false],
      ["Guest", true],
      ["Member", false],
    ])
    expect(people[0]).not.toHaveProperty("email")
    const elsewhere = await json(await call("GET", `/api/reports/${f.reportP2.id}/mentionable`, f.member))
    expect(elsewhere.map((person: { name: string }) => person.name)).toEqual(["Admin", "Member"])
    expect((await call("GET", `/api/reports/${f.reportP2.id}/mentionable`, f.guest)).status).toBe(404)
  })

  test("a member's mention reaches the guest: bell and email", async () => {
    await comment(f.member, f.reportP1.id, `@[user:${f.guest.user.id}] can you try again?`)
    await settle()
    expect((await notificationsOf(f.guest)).map((item) => item.kind)).toEqual(["mention"])
    expect(outbox.map((message) => message.to)).toEqual(["guest@kantor.test"])
    const threads = await json(await call("GET", `/api/reports/${f.reportP1.id}/comments`, f.member))
    expect(threads[0].mentions).toEqual([{ id: f.guest.user.id, name: "Guest" }])
  })

  test("the bell names a mentioned guest", async () => {
    await comment(f.member, f.reportP1.id, `@[user:${f.guest.user.id}] can you try again?`)
    await settle()
    const [item] = (await json(await call("GET", "/api/notifications", f.guest))).items
    expect(item.snippet).toBe("@Guest can you try again?")
  })

  test("a guest's mention reaches the member", async () => {
    await comment(f.guest, f.reportP1.id, `@[user:${f.member.user.id}] here is a video`)
    await settle()
    expect((await notificationsOf(f.member)).map((item) => item.kind)).toEqual(["mention"])
  })

  test("a mention of a guest on a report they can't read does nothing", async () => {
    await comment(f.member, f.reportP2.id, `@[user:${f.guest.user.id}] look`)
    await settle()
    expect(await notificationsOf(f.guest)).toEqual([])
    expect(outbox).toEqual([])
    const threads = await json(await call("GET", `/api/reports/${f.reportP2.id}/comments`, f.member))
    expect(threads[0].mentions).toEqual([])
  })

  test("a reply notifies a guest who is in the thread", async () => {
    const root = await json(await comment(f.guest, f.reportP1.id, "It breaks at checkout"))
    await comment(f.member, f.reportP1.id, "Fixed, try again", root.id)
    expect((await notificationsOf(f.guest)).map((item) => item.kind)).toEqual(["reply_to_you"])
  })

  test("a guest's bell drops a report that left their project", async () => {
    await comment(f.member, f.reportP1.id, `@[user:${f.guest.user.id}] look`)
    expect(await notificationsOf(f.guest)).toHaveLength(1)
    await ctx.db.update(report).set({ projectId: f.p2.id }).where(eq(report.id, f.reportP1.id))
    expect(await notificationsOf(f.guest)).toEqual([])
    expect((await comment(f.guest, f.reportP1.id, "Too late")).status).toBe(404)
  })

  test("a removed guest's bell is empty", async () => {
    await comment(f.member, f.reportP1.id, `@[user:${f.guest.user.id}] look`)
    await call("DELETE", `/api/projects/${f.p1.id}/guests/${f.guest.user.id}`, f.admin)
    expect(await notificationsOf(f.guest)).toEqual([])
  })

  test("the activity lines stay for members", async () => {
    expect((await call("GET", `/api/reports/${f.reportP1.id}/activity`, f.guest)).status).toBe(404)
  })
})
