import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { user, verification } from "../src/db/schema"
import type { EmailMessage, EmailSender } from "../src/email/sender"
import { createUser, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let outbox: EmailMessage[]

beforeEach(async () => {
  outbox = []
  const email: EmailSender = { send: async (message) => void outbox.push(message) }
  ctx = await setupTestApp({}, { email })
})

const post = (path: string, body: object) =>
  ctx.app.handle(
    new Request(`http://localhost/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
const requestCode = (email: string) => post("/email-otp/send-verification-otp", { email, type: "sign-in" })
const signIn = (email: string, otp: string) => post("/sign-in/email-otp", { email, otp })
const codeIn = (message: EmailMessage | undefined) => message?.text.match(/\b(\d{6})\b/)?.[1] ?? ""
const wrongCodeFor = (code: string) => (code === "000000" ? "999999" : "000000")

describe("email sign-in codes", () => {
  test("an allowed address gets a code and signs in, created as a member", async () => {
    expect((await requestCode("ana@kantor.test")).status).toBe(200)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.subject).toMatch(/^Your BugBerry sign-in code: \d{6}$/)
    const response = await signIn("ana@kantor.test", codeIn(outbox[0]))
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("session_token")
    const [row] = await ctx.db.select().from(user).where(eq(user.email, "ana@kantor.test"))
    expect(row?.emailVerified).toBe(true)
  })

  test("an email-code sign-up can't bring its own photo or an overlong name", async () => {
    await requestCode("ana@kantor.test")
    const response = await post("/sign-in/email-otp", {
      email: "ana@kantor.test",
      otp: codeIn(outbox[0]),
      image: "https://tracker.evil/p.png",
      name: "x".repeat(5000),
    })
    expect(response.status).toBe(200)
    const [row] = await ctx.db.select({ image: user.image, name: user.name }).from(user).where(eq(user.email, "ana@kantor.test"))
    expect(row?.image).toBeNull()
    expect(row?.name.length).toBeLessThanOrEqual(80)
  })

  test("a code for a domain that is not allowed is never sent", async () => {
    const allowed = await requestCode("ana@kantor.test")
    const refused = await requestCode("eve@evil.test")
    expect(refused.status).toBe(allowed.status)
    expect(await refused.text()).toBe(await allowed.text())
    expect(outbox.map((message) => message.to)).toEqual(["ana@kantor.test"])
    expect(await ctx.db.select().from(user).where(eq(user.email, "eve@evil.test"))).toHaveLength(0)
  })

  test("five wrong codes burn the code", async () => {
    await requestCode("ana@kantor.test")
    const code = codeIn(outbox[0])
    for (let i = 0; i < 5; i++) await signIn("ana@kantor.test", wrongCodeFor(code))
    expect((await signIn("ana@kantor.test", code)).status).not.toBe(200)
  })

  test("at most five codes per address in ten minutes", async () => {
    for (let i = 0; i < 7; i++) await requestCode("ana@kantor.test")
    expect(outbox).toHaveLength(5)
  })

  test("asking again after the limit never replaces the code already emailed", async () => {
    for (let i = 0; i < 7; i++) await requestCode("ana@kantor.test")
    expect(outbox).toHaveLength(5)
    expect((await signIn("ana@kantor.test", codeIn(outbox[4]))).status).toBe(200)
  })

  test("a refused address leaves no stored code behind", async () => {
    await requestCode("eve@evil.test")
    const rows = await ctx.db.select().from(verification)
    expect(rows.filter((row) => row.identifier.includes("eve@evil.test"))).toHaveLength(0)
  })

  test("a new account gets a name from its email instead of a blank one", async () => {
    await requestCode("ana.putri@kantor.test")
    await signIn("ana.putri@kantor.test", codeIn(outbox[0]))
    const [row] = await ctx.db.select().from(user).where(eq(user.email, "ana.putri@kantor.test"))
    expect(row?.name).toBe("ana.putri")
  })

  test("the same verified email signs in to the same account by any method", async () => {
    const existing = await createUser(ctx.db, { email: "ana@kantor.test" })
    await requestCode("ana@kantor.test")
    await signIn("ana@kantor.test", codeIn(outbox[0]))
    const rows = await ctx.db.select().from(user).where(eq(user.email, "ana@kantor.test"))
    expect(rows.map((row) => row.id)).toEqual([existing.id])
  })
})
