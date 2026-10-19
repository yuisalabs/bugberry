import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mentionEmail } from "../src/email/mention-email"
import type { EmailMessage } from "../src/email/sender"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let reportId: string
let sent: EmailMessage[]
let tasks: Promise<unknown>[]
let failing: boolean

const tag = (id: string) => `@[user:${id}]`

async function setup(overrides: Parameters<typeof setupTestApp>[0] = {}, withSender = true) {
  sent = []
  tasks = []
  failing = false
  const email = {
    async send(message: EmailMessage) {
      if (failing) throw new Error("smtp down")
      sent.push(message)
    },
  }
  ctx = await setupTestApp(overrides, { background: (task) => tasks.push(task), ...(withSender ? { email } : {}) })
  ana = await createUserWithToken(ctx.db, { name: "Ana", email: "ana@kantor.test" })
  budi = await createUserWithToken(ctx.db, { name: "Budi", email: "budi@kantor.test" })
  const project = await createProject(ctx.db)
  reportId = (await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id, title: "Pay button fails" })).id
}

const post = (body: string) => ctx.api.api.reports({ id: reportId }).comments.post({ body }, { headers: ana.headers })
const settle = () => Promise.all(tasks)

describe("mentionEmail", () => {
  test("comment text is escaped in the email", () => {
    const email = mentionEmail({
      actorName: "<i>Ana</i>",
      reportNumber: 3,
      reportTitle: "Pay & <b>go</b>",
      snippet: "<b>hi</b>",
      url: "http://localhost:3000/app/r/r1#comment-c1",
    })
    expect(email.subject).toBe("<i>Ana</i> mentioned you in BB-3: Pay & <b>go</b>")
    expect(email.html).toContain("&lt;b&gt;hi&lt;/b&gt;")
    expect(email.html).toContain("&lt;i&gt;Ana&lt;/i&gt;")
    expect(email.html).not.toContain("<b>")
    expect(email.html).toContain('href="http://localhost:3000/app/r/r1#comment-c1"')
    expect(email.html).toContain("Open report")
    expect(email.text).toContain("<b>hi</b>")
  })
})

describe("mention emails", () => {
  beforeEach(() => setup())

  test("a mentioned member gets one email with the comment and a link to it", async () => {
    const { data } = await post(`${tag(budi.user.id)} tolong cek ${tag(budi.user.id)}`)
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe("budi@kantor.test")
    expect(sent[0]?.subject).toBe("Ana mentioned you in BB-1: Pay button fails")
    expect(sent[0]?.text).toContain("@Budi tolong cek @Budi")
    expect(sent[0]?.text).toContain(`http://localhost:3000/app/r/${reportId}#comment-${data?.id}`)
  })

  test("an edit that adds nobody sends nothing", async () => {
    const id = (await post(`${tag(budi.user.id)} cek`)).data?.id ?? ""
    await settle()
    await ctx.api.api.comments({ id }).patch({ body: `${tag(budi.user.id)} cek lagi ${tag(ana.user.id)}` }, { headers: ana.headers })
    await settle()
    expect(sent).toHaveLength(1)
  })

  test("a failing email never fails the comment", async () => {
    failing = true
    const errors = spyOn(console, "error").mockImplementation(() => {})
    try {
      const { data, error } = await post(`${tag(budi.user.id)} cek`)
      expect(error).toBeNull()
      expect(data?.body).toBe(`${tag(budi.user.id)} cek`)
      await settle()
      expect(errors).toHaveBeenCalled()
      expect(String(errors.mock.calls[0]?.[0])).toContain("mention email")
    } finally {
      errors.mockRestore()
    }
  })
})

describe("mention emails with the log driver", () => {
  const fetchSpy = spyOn(globalThis, "fetch")
  afterEach(() => fetchSpy.mockClear())
  afterAll(() => fetchSpy.mockRestore())

  test("the log driver only logs", async () => {
    await setup({ email: { driver: "log", from: "BugBerry <no-reply@test>" } }, false)
    const info = spyOn(console, "info").mockImplementation(() => {})
    try {
      await post(`${tag(budi.user.id)} cek`)
      await settle()
      expect(info.mock.calls.some((call) => String(call[0]).includes("subject=Ana mentioned you in BB-1"))).toBe(true)
      expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes("resend"))).toBe(false)
    } finally {
      info.mockRestore()
    }
  })
})
