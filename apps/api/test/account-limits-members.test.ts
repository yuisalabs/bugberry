import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { joinRequest, user, workspace, workspaceInvitation, workspaceMember } from "../src/db/schema"
import type { EmailMessage } from "../src/email/sender"
import { createUserWithToken, setupTestApp } from "./helpers"

const LIMITS = { screenshots: 5, recordings: 5, ownedWorkspaces: 1 }

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let outbox: EmailMessage[]
let owner: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>

async function setup(limitsOn = true) {
  outbox = []
  ctx = await setupTestApp(
    { allowedEmailDomains: [], ...(limitsOn ? { accountLimits: LIMITS } : {}) },
    { email: { send: async (message) => void outbox.push(message) } },
  )
  owner = await createUserWithToken(ctx.db, { name: "Priya", role: "admin", email: "priya@kantor.test" })
  budi = await createUserWithToken(ctx.db, { name: "Budi", email: "budi@kantor.test", workspaceId: null })
  await ctx.db.update(workspace).set({ ownerId: owner.user.id }).where(eq(workspace.id, ctx.workspace.id))
}

beforeEach(() => setup())

const setUnlimited = (unlimited: boolean) => ctx.db.update(user).set({ unlimited }).where(eq(user.id, owner.user.id))
const ws = () => ctx.api.api.workspaces({ id: ctx.workspace.id })
const invite = (emails = ["budi@kantor.test"]) => ws().invitations.post({ emails }, { headers: owner.headers })
const tokenIn = (message: EmailMessage | undefined) => message?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1] ?? ""
const codeIn = (message: EmailMessage | undefined) => message?.text.match(/([2-9A-Z]{3}-[2-9A-Z]{4})/)?.[1] ?? ""
const refused = (result: { error: { status: unknown; value: unknown } | null }) => {
  expect(Number(result.error?.status)).toBe(403)
  expect(result.error?.value).toMatchObject({ code: "members_not_allowed", message: "Inviting teammates isn't available on this account." })
}
const ok = (result: { error: unknown }) => expect(result.error).toBeNull()
const isMember = async (userId: string) =>
  (await ctx.db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, ctx.workspace.id), eq(workspaceMember.userId, userId))))
    .length === 1
const pendingInvitation = async () =>
  (await ctx.db.select().from(workspaceInvitation).where(eq(workspaceInvitation.workspaceId, ctx.workspace.id)))[0]

/** An invitation sent while the owner was unlimited, then the exemption taken away. */
async function invitationFromBefore() {
  await setUnlimited(true)
  ok(await invite())
  await setUnlimited(false)
  return { token: tokenIn(outbox[0]), code: codeIn(outbox[0]), id: (await pendingInvitation())?.id ?? "" }
}

describe("a limited workspace takes no new members", () => {
  test("sending and resending invitations is refused", async () => {
    refused(await invite())
    const { id } = await invitationFromBefore()
    refused(await ws().invitations({ invitationId: id }).resend.post(undefined, { headers: owner.headers }))
  })

  test("an invitation from before can't be accepted by link, from the list or by code, and stays pending", async () => {
    const { token, code, id } = await invitationFromBefore()
    refused(await ctx.api.api.invitations({ token }).accept.post(undefined, { headers: budi.headers }))
    refused(await ctx.api.api.me.invitations({ id }).accept.post(undefined, { headers: budi.headers }))
    refused(await ctx.api.api.join.post({ value: code }, { headers: budi.headers }))
    expect(await isMember(budi.user.id)).toBe(false)
    expect((await pendingInvitation())?.acceptedAt).toBeNull()
  })

  test("a shared link from before doesn't let anyone in", async () => {
    await ctx.db.update(workspace).set({ shareCode: "ABC-2345" }).where(eq(workspace.id, ctx.workspace.id))
    refused(await ctx.api.api.join.post({ value: "https://x.test/join/ABC-2345" }, { headers: budi.headers }))
    expect(await isMember(budi.user.id)).toBe(false)
  })

  test("joining by email domain is refused, directly or by request", async () => {
    const domainJoin = () => ctx.api.api.join.domain({ workspaceId: ctx.workspace.id }).post(undefined, { headers: budi.headers })
    await ctx.db.update(workspace).set({ joinDomain: "kantor.test", joinMode: "direct" }).where(eq(workspace.id, ctx.workspace.id))
    refused(await domainJoin())
    await ctx.db.update(workspace).set({ joinMode: "approval" }).where(eq(workspace.id, ctx.workspace.id))
    refused(await domainJoin())
    expect(await ctx.db.select().from(joinRequest)).toHaveLength(0)
    expect(await isMember(budi.user.id)).toBe(false)
  })

  test("a join request from before can't be approved", async () => {
    await ctx.db.insert(joinRequest).values({ workspaceId: ctx.workspace.id, userId: budi.user.id })
    refused(await ws()["join-requests"]({ userId: budi.user.id }).approve.post(undefined, { headers: owner.headers }))
    expect(await isMember(budi.user.id)).toBe(false)
  })

  test("opening a way in is refused", async () => {
    const setAccess = (body: Parameters<ReturnType<typeof ws>["access"]["patch"]>[0]) => ws().access.patch(body, { headers: owner.headers })
    refused(await setAccess({ shareLink: "on" }))
    refused(await setAccess({ shareLink: "reset" }))
    refused(await setAccess({ joinDomain: "kantor.test" }))
  })
})

describe("closing doors still works in a limited workspace", () => {
  test("turning the share link off and clearing the domain", async () => {
    await ctx.db
      .update(workspace)
      .set({ shareCode: "ABC-2345", joinDomain: "kantor.test", joinMode: "direct" })
      .where(eq(workspace.id, ctx.workspace.id))
    ok(await ws().access.patch({ shareLink: "off" }, { headers: owner.headers }))
    ok(await ws().access.patch({ joinDomain: null }, { headers: owner.headers }))
    const [row] = await ctx.db.select({ shareCode: workspace.shareCode, joinDomain: workspace.joinDomain }).from(workspace)
    expect(row).toEqual({ shareCode: null, joinDomain: null })
  })

  test("revoking an invitation and declining a request", async () => {
    const { id } = await invitationFromBefore()
    ok(await ws().invitations({ invitationId: id }).delete(undefined, { headers: owner.headers }))
    await ctx.db.insert(joinRequest).values({ workspaceId: ctx.workspace.id, userId: budi.user.id })
    ok(await ws()["join-requests"]({ userId: budi.user.id }).delete(undefined, { headers: owner.headers }))
  })

  test("removing a member, and a member leaving", async () => {
    const sari = await createUserWithToken(ctx.db, { role: "member" })
    const andi = await createUserWithToken(ctx.db, { role: "member" })
    ok(await ws().members({ userId: sari.user.id }).delete(undefined, { headers: owner.headers }))
    ok(await ws().members({ userId: andi.user.id }).delete(undefined, { headers: andi.headers }))
    expect(await isMember(sari.user.id)).toBe(false)
    expect(await isMember(andi.user.id)).toBe(false)
  })
})

describe("no limit", () => {
  test("an unlimited owner invites, and an ordinary account accepts", async () => {
    await setUnlimited(true)
    ok(await invite())
    ok(await ctx.api.api.invitations({ token: tokenIn(outbox[0]) }).accept.post(undefined, { headers: budi.headers }))
    expect(await isMember(budi.user.id)).toBe(true)
  })

  test("limits off: an ordinary owner invites as before", async () => {
    await setup(false)
    ok(await invite())
    ok(await ctx.api.api.invitations({ token: tokenIn(outbox[0]) }).accept.post(undefined, { headers: budi.headers }))
    expect(await isMember(budi.user.id)).toBe(true)
  })
})
