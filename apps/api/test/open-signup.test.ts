import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { user, workspaceMember } from "../src/db/schema"
import type { EmailMessage } from "../src/lib/email/sender"
import { setupTestApp } from "./helpers"

async function appWith(allowedEmailDomains: string[]) {
  const outbox: EmailMessage[] = []
  const ctx = await setupTestApp({ allowedEmailDomains }, { email: { send: async (message) => void outbox.push(message) } })
  const post = (path: string, body: object) =>
    ctx.app.handle(
      new Request(`http://localhost/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
  return { ctx, outbox, post }
}

describe("open sign-up", () => {
  test("with no domain list, anyone signs up by email code and gets a workspace", async () => {
    const { ctx, outbox, post } = await appWith([])
    await post("/email-otp/send-verification-otp", { email: "new@anywhere.test", type: "sign-in" })
    const code = outbox[0]?.text.match(/\b(\d{6})\b/)?.[1] ?? ""
    expect((await post("/sign-in/email-otp", { email: "new@anywhere.test", otp: code })).status).toBe(200)
    const [created] = await ctx.db.select({ id: user.id }).from(user).where(eq(user.email, "new@anywhere.test"))
    const memberships = await ctx.db.select().from(workspaceMember).where(eq(workspaceMember.userId, created?.id ?? ""))
    expect(memberships).toHaveLength(1)
  })

  test("with a domain list, other domains still get no code", async () => {
    const { outbox, post } = await appWith(["kantor.test"])
    await post("/email-otp/send-verification-otp", { email: "x@other.test", type: "sign-in" })
    expect(outbox).toEqual([])
  })
})
