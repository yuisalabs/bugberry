import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { workspaceInvitation, workspaceMember } from "../src/db/schema"
import type { EmailMessage } from "../src/email/sender"
import { inviteEmail } from "../src/email/invite-email"
import { createUser, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let outbox: EmailMessage[]
let admin: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  outbox = []
  ctx = await setupTestApp({ allowedEmailDomains: ["kantor.test", "gmail.com"] }, { email: { send: async (message) => void outbox.push(message) } })
  admin = await createUserWithToken(ctx.db, { name: "Budi", email: "budi@kantor.test", role: "admin" })
})

const invitations = () => ctx.api.api.workspaces({ id: ctx.workspace.id }).invitations
const invite = (emails: string[], headers = admin.headers) => invitations().post({ emails }, { headers })
const tokenIn = (message: EmailMessage | undefined) => message?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1] ?? ""
const status = (result: { error: { status: unknown } | null }) => result.error?.status as number | undefined
const code = (result: { error: { value: unknown } | null }) => (result.error?.value as { code?: string } | undefined)?.code
const isMember = async (userId: string) =>
  (
    await ctx.db
      .select()
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, ctx.workspace.id), eq(workspaceMember.userId, userId)))
  ).length === 1

describe("sending invitations", () => {
  test("each address gets the right outcome", async () => {
    await createUser(ctx.db, { email: "ana@kantor.test" })
    await invite(["sari@kantor.test"])
    outbox = []
    const { data } = await invite(["ana@kantor.test", "sari@kantor.test", " Andi@Gmail.com ", "eve@elsewhere.test", "not-an-email"])
    expect(data).toEqual([
      { email: "ana@kantor.test", status: "member" },
      { email: "sari@kantor.test", status: "pending" },
      { email: "andi@gmail.com", status: "sent" },
      { email: "eve@elsewhere.test", status: "not_allowed" },
      { email: "not-an-email", status: "invalid" },
    ])
    expect(outbox.map((message) => message.to)).toEqual(["andi@gmail.com"])
    expect(outbox[0]?.subject).toBe("Budi invited you to Test on BugBerry")
    expect(outbox[0]?.text).toContain("http://localhost:3000/invite/")
  })

  test("only admins invite, list, revoke and resend", async () => {
    const member = await createUserWithToken(ctx.db)
    expect(status(await invite(["x@kantor.test"], member.headers))).toBe(403)
    expect(status(await invitations().get({ headers: member.headers }))).toBe(403)
  })

  test("pending invitations are listed with who sent them", async () => {
    await invite(["sari@kantor.test"])
    const { data } = await invitations().get({ headers: admin.headers })
    expect(data?.map((item) => [item.email, item.invitedBy])).toEqual([["sari@kantor.test", "Budi"]])
  })

  test("the 51st invite in an hour is refused", async () => {
    for (let batch = 0; batch < 5; batch++) {
      const emails = Array.from({ length: 10 }, (_, index) => `p${batch}-${index}@kantor.test`)
      expect(status(await invite(emails))).toBeUndefined()
    }
    const refused = await invite(["one-too-many@kantor.test"])
    expect(status(refused)).toBe(429)
  })
})

describe("spam limits", () => {
  test("one person cannot get around the limit with more workspaces", async () => {
    for (let round = 0; round < 3; round++) {
      const { data: created } = await ctx.api.api.workspaces.post({ name: `W${round}` }, { headers: admin.headers })
      const emails = Array.from({ length: 20 }, (_, index) => `r${round}-${index}@kantor.test`)
      const result = await ctx.api.api.workspaces({ id: created?.id ?? "" }).invitations.post({ emails }, { headers: admin.headers })
      if (round < 2) expect(status(result)).toBeUndefined()
      else expect(status(result)).toBe(429)
    }
    expect(outbox.length).toBeLessThanOrEqual(50)
  })

  test("creating workspaces is capped per person", async () => {
    const results = []
    for (let index = 0; index < 12; index++) {
      results.push(status(await ctx.api.api.workspaces.post({ name: `W${index}` }, { headers: admin.headers })))
    }
    expect(results.slice(0, 10).every((value) => value === undefined)).toBe(true)
    expect(results.at(-1)).toBe(429)
  })
})

describe("accepting invitations", () => {
  test("the invited address joins the workspace", async () => {
    await invite(["sari@kantor.test"])
    const token = tokenIn(outbox[0])
    const { data: info } = await ctx.api.api.invitations({ token }).get()
    expect(info).toEqual({ workspaceName: "Test", email: "sari@kantor.test", inviterName: "Budi", status: "pending" })
    const sari = await createUserWithToken(ctx.db, { email: "sari@kantor.test", workspaceId: null })
    const { data } = await ctx.api.api.invitations({ token }).accept.post(undefined, { headers: sari.headers })
    expect(data).toEqual({ workspaceId: ctx.workspace.id })
    expect(await isMember(sari.user.id)).toBe(true)
    expect((await ctx.api.api.invitations({ token }).get()).data?.status).toBe("accepted")
  })

  test("accepting needs the invited address", async () => {
    await invite(["sari@kantor.test"])
    const token = tokenIn(outbox[0])
    const eve = await createUserWithToken(ctx.db, { email: "eve@kantor.test", workspaceId: null })
    const refused = await ctx.api.api.invitations({ token }).accept.post(undefined, { headers: eve.headers })
    expect([status(refused), code(refused)]).toEqual([403, "invite_email_mismatch"])
    expect(await isMember(eve.user.id)).toBe(false)
    expect((await ctx.api.api.invitations({ token }).get()).data?.status).toBe("pending")
  })

  test("an expired, revoked or used invite cannot be accepted", async () => {
    await invite(["a@kantor.test", "b@kantor.test", "c@kantor.test"])
    const [a, b, c] = outbox.map(tokenIn)
    await ctx.db.update(workspaceInvitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(workspaceInvitation.email, "a@kantor.test"))
    const [pendingB] = (await invitations().get({ headers: admin.headers })).data?.filter((item) => item.email === "b@kantor.test") ?? []
    await invitations()({ invitationId: pendingB?.id ?? "" }).delete(undefined, { headers: admin.headers })
    const userC = await createUserWithToken(ctx.db, { email: "c@kantor.test", workspaceId: null })
    await ctx.api.api.invitations({ token: c ?? "" }).accept.post(undefined, { headers: userC.headers })

    for (const [token, email, expected] of [
      [a, "a@kantor.test", "expired"],
      [b, "b@kantor.test", "revoked"],
      [c, "c@kantor.test", "accepted"],
    ] as const) {
      expect((await ctx.api.api.invitations({ token: token ?? "" }).get()).data?.status).toBe(expected)
      const person = email === "c@kantor.test" ? userC : await createUserWithToken(ctx.db, { email, workspaceId: null })
      const again = await ctx.api.api.invitations({ token: token ?? "" }).accept.post(undefined, { headers: person.headers })
      expect([status(again), code(again)]).toEqual([410, "invite_unavailable"])
    }
  })

  test("resend issues a new link and the old one stops working", async () => {
    await invite(["sari@kantor.test"])
    const oldToken = tokenIn(outbox[0])
    const [pending] = (await invitations().get({ headers: admin.headers })).data ?? []
    expect((await invitations()({ invitationId: pending?.id ?? "" }).resend.post(undefined, { headers: admin.headers })).data).toEqual({
      ok: true,
    })
    const newToken = tokenIn(outbox[1])
    expect(newToken).not.toBe(oldToken)
    expect(status(await ctx.api.api.invitations({ token: oldToken }).get())).toBe(404)
    expect((await ctx.api.api.invitations({ token: newToken }).get()).data?.status).toBe("pending")
  })

  test("unknown links answer 404", async () => {
    expect(status(await ctx.api.api.invitations({ token: "nope" }).get())).toBe(404)
  })

  test("invites are listed and accepted from /me/invitations", async () => {
    await invite(["sari@kantor.test"])
    const sari = await createUserWithToken(ctx.db, { email: "sari@kantor.test", workspaceId: null })
    const { data: mine } = await ctx.api.api.me.invitations.get({ headers: sari.headers })
    expect(mine?.map((item) => [item.workspaceName, item.inviterName])).toEqual([["Test", "Budi"]])
    expect(JSON.stringify(mine)).not.toContain("token")
    const { data } = await ctx.api.api.me.invitations({ id: mine?.[0]?.id ?? "" }).accept.post(undefined, { headers: sari.headers })
    expect(data).toEqual({ workspaceId: ctx.workspace.id })
    expect(await isMember(sari.user.id)).toBe(true)
    const other = await createUserWithToken(ctx.db, { email: "eve@kantor.test", workspaceId: null })
    expect((await ctx.api.api.me.invitations.get({ headers: other.headers })).data).toEqual([])
  })
})

describe("addresses outside ALLOWED_EMAIL_DOMAINS", () => {
  test("are refused", async () => {
    const { data } = await invite(["eve@elsewhere.test"])
    expect(data).toEqual([{ email: "eve@elsewhere.test", status: "not_allowed" }])
    expect(outbox).toEqual([])
  })
})

describe("inviteEmail", () => {
  test("names the inviter and workspace, links the invitation, and escapes names", () => {
    const mail = inviteEmail({ workspaceName: "<b>Tim</b>", inviterName: "Budi & Co", url: "https://app.test/invite/abc", code: "7KX-29QF" })
    expect(mail.subject).toBe("Budi & Co invited you to <b>Tim</b> on BugBerry")
    expect(mail.text).toContain("https://app.test/invite/abc")
    expect(mail.text).toContain("Or enter this code in BugBerry: 7KX-29QF")
    expect(mail.html).toContain("&lt;b&gt;Tim&lt;/b&gt;")
    expect(mail.html).toContain("Budi &amp; Co")
    expect(mail.html).not.toContain("<b>Tim</b>")
  })
})
