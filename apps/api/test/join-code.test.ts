import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { workspace, workspaceInvitation, workspaceMember } from "../src/db/schema"
import type { EmailMessage } from "../src/email/sender"
import { newJoinCode, normalizeCode, parseJoinValue } from "../src/modules/join/join-codes"
import { createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let outbox: EmailMessage[]
let admin: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  outbox = []
  ctx = await setupTestApp({ allowedEmailDomains: ["kantor.test"] }, { email: { send: async (message) => void outbox.push(message) } })
  admin = await createUserWithToken(ctx.db, { name: "Priya", role: "admin", email: "priya@kantor.test" })
})

const preview = (value: string, headers: Record<string, string>) => ctx.api.api.join.preview.post({ value }, { headers })
const joinWith = (value: string, headers: Record<string, string>) => ctx.api.api.join.post({ value }, { headers })
const roleIn = async (userId: string) =>
  (
    await ctx.db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, ctx.workspace.id), eq(workspaceMember.userId, userId)))
  ).map((row) => row.role)
const codeFrom = (message: EmailMessage | undefined) => message?.text.match(/Or enter this code in BugBerry: ([2-9A-Z]{3}-[2-9A-Z]{4})/)?.[1] ?? ""

describe("join codes", () => {
  test("codes look like XXX-XXXX and read loosely", () => {
    expect(newJoinCode()).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{4}$/)
    expect(normalizeCode(" 7kx-29qf ")).toBe("7KX29QF")
    expect(parseJoinValue("https://b.test/invite/abc_DEF-1")).toEqual({ kind: "token", token: "abc_DEF-1" })
    expect(parseJoinValue("https://b.test/join/7KX-29QF")).toEqual({ kind: "share", code: "7KX29QF" })
    expect(parseJoinValue(" 7kx 29qf ")).toEqual({ kind: "code", code: "7KX29QF" })
    expect(parseJoinValue("hello")).toBeNull()
  })

  test("an invitation email carries its code, and the code joins the invited person", async () => {
    const budi = await createUserWithToken(ctx.db, { name: "Budi", email: "budi@kantor.test", workspaceId: null })
    await ctx.api.api.workspaces({ id: ctx.workspace.id }).invitations.post({ emails: ["budi@kantor.test"] }, { headers: admin.headers })
    const code = codeFrom(outbox[0])
    expect(code).not.toBe("")
    const { data } = await preview(code.toLowerCase(), budi.headers)
    expect(data).toMatchObject({ via: "invitation", inviterName: "Priya", alreadyMember: false, workspace: { id: ctx.workspace.id } })
    expect((await joinWith(code, budi.headers)).data).toEqual({ workspaceId: ctx.workspace.id })
    expect(await roleIn(budi.user.id)).toEqual(["member"])
    const [invitation] = await ctx.db.select().from(workspaceInvitation).where(eq(workspaceInvitation.email, "budi@kantor.test"))
    expect(invitation?.acceptedAt).not.toBeNull()
  })

  test("a personal code works only for the invited email", async () => {
    const sari = await createUserWithToken(ctx.db, { name: "Sari", email: "sari@kantor.test", workspaceId: null })
    const budi = await createUserWithToken(ctx.db, { name: "Budi", email: "budi@kantor.test", workspaceId: null })
    await ctx.api.api.workspaces({ id: ctx.workspace.id }).invitations.post({ emails: ["budi@kantor.test"] }, { headers: admin.headers })
    const code = codeFrom(outbox[0])
    const wrong = await joinWith(code, sari.headers)
    expect(wrong.error?.status as number | undefined).toBe(404)
    expect(wrong.error?.value).toMatchObject({ code: "join_code_invalid", message: "This link or code doesn't work" })
    expect(await roleIn(sari.user.id)).toEqual([])
    expect((await joinWith(code, budi.headers)).error).toBeNull()
  })

  test("the shared link joins anyone allowed, as Member", async () => {
    await ctx.db.update(workspace).set({ shareCode: "ABC-2345" }).where(eq(workspace.id, ctx.workspace.id))
    const outsider = await createUserWithToken(ctx.db, { name: "Andi", email: "andi@kantor.test", workspaceId: null })
    expect((await preview("https://x.test/join/abc-2345", outsider.headers)).data).toMatchObject({ via: "shared", inviterName: null })
    expect((await joinWith("https://x.test/join/abc-2345", outsider.headers)).error).toBeNull()
    expect((await joinWith("ABC2345", outsider.headers)).error).toBeNull()
    expect(await roleIn(outsider.user.id)).toEqual(["member"])
  })

  test("reset and off kill the old shared code", async () => {
    const outsider = await createUserWithToken(ctx.db, { name: "Andi", email: "andi@kantor.test", workspaceId: null })
    await ctx.db.update(workspace).set({ shareCode: "ABC-2345" }).where(eq(workspace.id, ctx.workspace.id))
    await ctx.db.update(workspace).set({ shareCode: "XYZ-6789" }).where(eq(workspace.id, ctx.workspace.id))
    expect((await preview("ABC-2345", outsider.headers)).error?.status as number | undefined).toBe(404)
    await ctx.db.update(workspace).set({ shareCode: null }).where(eq(workspace.id, ctx.workspace.id))
    expect((await preview("XYZ-6789", outsider.headers)).error?.status as number | undefined).toBe(404)
  })

  test("server domain rules still apply", async () => {
    await ctx.db.update(workspace).set({ shareCode: "ABC-2345" }).where(eq(workspace.id, ctx.workspace.id))
    const stranger = await createUserWithToken(ctx.db, { name: "Eve", email: "eve@other.test", workspaceId: null })
    // The sign-in check already refuses a domain the server does not allow (403); either way nobody joins.
    expect([403, 404]).toContain((await joinWith("ABC-2345", stranger.headers)).error?.status as number)
    expect(await roleIn(stranger.user.id)).toEqual([])
  })

  test("code lookups are rate limited", async () => {
    const someone = await createUserWithToken(ctx.db, { name: "Guess", email: "guess@kantor.test", workspaceId: null })
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) statuses.push(((await preview(`AAA-${2000 + i}`, someone.headers)).error?.status as number) ?? 200)
    expect(statuses.slice(0, 20).every((status) => status === 404)).toBe(true)
    expect(statuses[20]).toBe(429)
  })
})
