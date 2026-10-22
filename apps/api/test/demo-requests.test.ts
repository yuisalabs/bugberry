import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import type { DemoRequestInput } from "@bugberry/shared"
import { demoRequestEmail } from "../src/email/demo-request-email"
import type { EmailMessage } from "../src/email/sender"
import { demoRequest } from "../src/db/schema"
import { setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let sent: EmailMessage[]
let tasks: Promise<unknown>[]
let failing: boolean

async function setup(overrides: Parameters<typeof setupTestApp>[0] = {}) {
  sent = []
  tasks = []
  failing = false
  const email = {
    async send(message: EmailMessage) {
      if (failing) throw new Error("smtp down")
      sent.push(message)
    },
  }
  ctx = await setupTestApp(
    { publicSite: true, demoRequestEmail: "sales@bugberry.test", ...overrides },
    { email, background: (task) => tasks.push(task) },
  )
}

const valid: DemoRequestInput = {
  firstName: "Hannan",
  lastName: "Rozen",
  email: "hannan@northwind.test",
  company: "Northwind Commerce",
  tracker: "Jira",
  teamSize: "11–50",
  message: "Recording checkout bugs and sending them to Jira",
  selfHosting: true,
  website: "",
}

const post = (body: object) => ctx.api.api["demo-requests"].post(body as DemoRequestInput)
const settle = () => Promise.all(tasks)
const rows = () => ctx.db.select().from(demoRequest)

beforeEach(() => setup())
afterAll(() => setup())

describe("demo requests", () => {
  test("stores the request and emails the team", async () => {
    const { status, data } = await post({ ...valid, company: "  Northwind Commerce  " })
    expect(status).toBe(200)
    expect(data).toEqual({ ok: true })
    await settle()
    const [row] = await rows()
    expect(row).toMatchObject({
      firstName: "Hannan",
      lastName: "Rozen",
      email: "hannan@northwind.test",
      company: "Northwind Commerce",
      tracker: "Jira",
      teamSize: "11–50",
      message: "Recording checkout bugs and sending them to Jira",
      selfHosting: true,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe("sales@bugberry.test")
    for (const part of ["Northwind Commerce", "hannan@northwind.test", "11–50", "Self-hosting: yes"]) {
      expect(sent[0]?.text).toContain(part)
    }
  })

  test("is not there when the public site is off", async () => {
    await setup({ publicSite: false })
    expect((await post(valid)).status).toBe(404)
    expect(await rows()).toHaveLength(0)
  })

  test("rejects invalid fields", async () => {
    for (const bad of [
      { email: "nope" },
      { teamSize: "9000" },
      { tracker: "Asana" },
      { firstName: "" },
      { firstName: "   " },
      { message: "x".repeat(2001) },
      { company: "x".repeat(121) },
    ]) {
      expect((await post({ ...valid, ...bad })).status).toBe(422)
    }
    expect(await rows()).toHaveLength(0)
  })

  test("a filled honeypot is thanked and dropped", async () => {
    const { status, data } = await post({ ...valid, website: "http://spam.test" })
    expect(status).toBe(200)
    expect(data).toEqual({ ok: true })
    await settle()
    expect(await rows()).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  test("the sixth request from one address in an hour is refused", async () => {
    for (let i = 0; i < 5; i++) expect((await post(valid)).status).toBe(200)
    expect((await post(valid)).status).toBe(429)
    expect(await rows()).toHaveLength(5)
  })

  test("a failing mail service still keeps the lead", async () => {
    failing = true
    expect((await post(valid)).status).toBe(200)
    await settle()
    expect(await rows()).toHaveLength(1)
  })

  test("without DEMO_REQUEST_EMAIL the request is stored, not emailed", async () => {
    await setup({ demoRequestEmail: null })
    expect((await post(valid)).status).toBe(200)
    await settle()
    expect(await rows()).toHaveLength(1)
    expect(sent).toHaveLength(0)
  })
})

describe("demoRequestEmail", () => {
  test("escapes what people typed", () => {
    const email = demoRequestEmail({ ...valid, company: "<b>Acme</b>", receivedAt: new Date("2026-10-22T10:00:00Z") })
    expect(email.subject).toBe("Demo request: <b>Acme</b> (Hannan Rozen)")
    expect(email.html).toContain("&lt;b&gt;Acme&lt;/b&gt;")
    expect(email.html).not.toContain("<b>Acme</b>")
  })
})
