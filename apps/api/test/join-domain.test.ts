import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { joinRequest, workspaceMember } from "../src/db/schema"
import { createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  ctx = await setupTestApp({ allowedEmailDomains: [] })
  admin = await createUserWithToken(ctx.db, { name: "Priya", role: "admin", email: "priya@kantor.test" })
  budi = await createUserWithToken(ctx.db, { name: "Budi", email: "budi@kantor.test", workspaceId: null })
})

const access = () => ctx.api.api.workspaces({ id: ctx.workspace.id }).access
const setAccess = (body: Parameters<ReturnType<typeof access>["patch"]>[0], headers = admin.headers) => access().patch(body, { headers })
const domainList = (headers = budi.headers) => ctx.api.api.join.domain.get({ headers })
const domainJoin = (headers = budi.headers) => ctx.api.api.join.domain({ workspaceId: ctx.workspace.id }).post(undefined, { headers })
const requests = () => ctx.api.api.workspaces({ id: ctx.workspace.id })["join-requests"]
const isMember = async (userId: string) =>
  (
    await ctx.db
      .select()
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, ctx.workspace.id), eq(workspaceMember.userId, userId)))
  ).length === 1
const requestRows = () => ctx.db.select().from(joinRequest).where(eq(joinRequest.workspaceId, ctx.workspace.id))

describe("workspace access and joining by domain", () => {
  test("the domain must be the admin's own, and not a free mail domain", async () => {
    expect((await access().get({ headers: admin.headers })).data).toEqual({ shareCode: null, joinDomain: null, joinMode: null, ownDomain: "kantor.test" })
    expect((await setAccess({ joinDomain: "kantor.test" })).data).toMatchObject({ joinDomain: "kantor.test", joinMode: "approval" })
    const foreign = await setAccess({ joinDomain: "evil.test" })
    expect(foreign.error?.status as number | undefined).toBe(422)
    expect(foreign.error?.value).toMatchObject({ code: "domain_not_allowed" })
    const gmailAdmin = await createUserWithToken(ctx.db, { name: "G", role: "admin", email: "g@gmail.com" })
    expect((await access().get({ headers: gmailAdmin.headers })).data?.ownDomain).toBeNull()
    expect((await setAccess({ joinDomain: "gmail.com" }, gmailAdmin.headers)).error?.status as number | undefined).toBe(422)
    expect((await access().get({ headers: admin.headers })).data?.joinDomain).toBe("kantor.test")
  })

  test("direct domain join", async () => {
    await setAccess({ joinDomain: "kantor.test", joinMode: "direct" })
    expect((await domainList()).data).toEqual([
      { workspace: expect.objectContaining({ id: ctx.workspace.id, name: "Test" }), mode: "direct", requested: false },
    ])
    expect((await domainJoin()).data).toEqual({ workspaceId: ctx.workspace.id })
    expect(await isMember(budi.user.id)).toBe(true)
    expect((await domainList()).data).toEqual([])
  })

  test("approval: request, cancel, approve, decline", async () => {
    await setAccess({ joinDomain: "kantor.test", joinMode: "approval" })
    expect((await domainJoin()).data).toEqual({ requested: true })
    expect((await domainList()).data?.[0]).toMatchObject({ mode: "approval", requested: true })
    await ctx.api.api.join.domain({ workspaceId: ctx.workspace.id }).request.delete(undefined, { headers: budi.headers })
    expect(await requestRows()).toHaveLength(0)

    await domainJoin()
    expect((await requests().get({ headers: admin.headers })).data?.map((row) => row.user.email)).toEqual(["budi@kantor.test"])
    expect((await requests()({ userId: budi.user.id }).approve.post(undefined, { headers: admin.headers })).data).toEqual({ ok: true })
    expect(await isMember(budi.user.id)).toBe(true)
    expect(await requestRows()).toHaveLength(0)

    const sari = await createUserWithToken(ctx.db, { name: "Sari", email: "sari@kantor.test", workspaceId: null })
    await domainJoin(sari.headers)
    await requests()({ userId: sari.user.id }).delete(undefined, { headers: admin.headers })
    expect(await requestRows()).toHaveLength(0)
    expect(await isMember(sari.user.id)).toBe(false)
    expect((await domainJoin(sari.headers)).data).toEqual({ requested: true })
  })

  test("requests are single and approving is idempotent", async () => {
    await setAccess({ joinDomain: "kantor.test", joinMode: "approval" })
    await domainJoin()
    await domainJoin()
    expect(await requestRows()).toHaveLength(1)
    const approve = () => requests()({ userId: budi.user.id }).approve.post(undefined, { headers: admin.headers })
    expect((await approve()).data).toEqual({ ok: true })
    expect((await approve()).data).toEqual({ ok: true })
    expect(await requestRows()).toHaveLength(0)
  })

  test("members can't see or change access, requests or settings", async () => {
    const member = await createUserWithToken(ctx.db, { name: "M", email: "m@kantor.test", role: "member" })
    expect((await access().get({ headers: member.headers })).error?.status as number | undefined).toBe(403)
    expect((await setAccess({ shareLink: "on" }, member.headers)).error?.status as number | undefined).toBe(403)
    expect((await requests().get({ headers: member.headers })).error?.status as number | undefined).toBe(403)
    const approve = await requests()({ userId: budi.user.id }).approve.post(undefined, { headers: member.headers })
    expect(approve.error?.status as number | undefined).toBe(403)
  })

  test("turning the shared link on twice gives different codes", async () => {
    const first = (await setAccess({ shareLink: "on" })).data?.shareCode ?? ""
    expect(first).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{4}$/)
    expect((await setAccess({ shareLink: "off" })).data?.shareCode).toBeNull()
    const second = (await setAccess({ shareLink: "on" })).data?.shareCode ?? ""
    expect(second).not.toBe(first)
    const reset = (await setAccess({ shareLink: "reset" })).data?.shareCode ?? ""
    expect(reset).not.toBe(second)
  })

  test("requests survive the domain being turned off", async () => {
    await setAccess({ joinDomain: "kantor.test", joinMode: "approval" })
    await domainJoin()
    await setAccess({ joinDomain: null })
    expect((await requests().get({ headers: admin.headers })).data).toHaveLength(1)
    expect((await requests()({ userId: budi.user.id }).approve.post(undefined, { headers: admin.headers })).data).toEqual({ ok: true })
    expect(await isMember(budi.user.id)).toBe(true)
  })

  test("joining another way clears a waiting request", async () => {
    await setAccess({ joinDomain: "kantor.test", joinMode: "approval" })
    await domainJoin()
    const code = (await setAccess({ shareLink: "on" })).data?.shareCode ?? ""
    expect((await ctx.api.api.join.post({ value: code }, { headers: budi.headers })).error).toBeNull()
    expect(await requestRows()).toHaveLength(0)

    const sari = await createUserWithToken(ctx.db, { name: "Sari", email: "sari@kantor.test", workspaceId: null })
    await domainJoin(sari.headers)
    await setAccess({ joinMode: "direct" })
    expect((await domainJoin(sari.headers)).data).toEqual({ workspaceId: ctx.workspace.id })
    expect(await requestRows()).toHaveLength(0)
  })

  test("a workspace with no domain match can't be joined by domain", async () => {
    expect((await domainJoin()).error?.status as number | undefined).toBe(404)
  })
})
