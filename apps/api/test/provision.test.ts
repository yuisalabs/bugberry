import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { joinRequest, user, workspace, workspaceInvitation, workspaceMember } from "../src/db/schema"
import type { EmailMessage } from "../src/lib/email/sender"
import { newId } from "../src/lib/ids"
import { defaultWorkspaceName, provisionNewUser } from "../src/modules/workspaces/provision"
import { createUser, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const DAY = 24 * 60 * 60 * 1000

async function invite(email: string, changes: Partial<typeof workspaceInvitation.$inferInsert> = {}) {
  await ctx.db.insert(workspaceInvitation).values({
    id: newId(),
    workspaceId: ctx.workspace.id,
    email,
    tokenHash: newId(),
    expiresAt: new Date(Date.now() + 7 * DAY),
    ...changes,
  })
}

const workspacesOf = (userId: string) =>
  ctx.db
    .select({ name: workspace.name, role: workspaceMember.role })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(eq(workspaceMember.userId, userId))

describe("defaultWorkspaceName", () => {
  test("the first name, else the address's local part", () => {
    expect(defaultWorkspaceName("Budi Santoso", "b@x.co")).toBe("Budi's workspace")
    expect(defaultWorkspaceName("", "sari@x.co")).toBe("sari's workspace")
    expect(defaultWorkspaceName("  ", "sari@x.co")).toBe("sari's workspace")
  })
})

describe("provisionNewUser", () => {
  test("a new person gets their own workspace as admin, and it becomes their current one", async () => {
    const person = await createUser(ctx.db, { name: "Budi Santoso", email: "budi@ptmaju.com", workspaceId: null })
    await provisionNewUser(ctx.db, person, null)
    expect(await workspacesOf(person.id)).toEqual([{ name: "Budi's workspace", role: "admin" }])
    const [row] = await ctx.db.select({ last: user.lastWorkspaceId }).from(user).where(eq(user.id, person.id))
    expect(row?.last).toBeTruthy()
  })

  test("someone with a live invitation gets no workspace of their own", async () => {
    await invite("sari@ptmaju.com")
    const person = await createUser(ctx.db, { name: "Sari", email: "sari@ptmaju.com", workspaceId: null })
    await provisionNewUser(ctx.db, person, null)
    expect(await workspacesOf(person.id)).toEqual([])
  })

  test("expired, revoked or used invitations do not count", async () => {
    await invite("a@x.co", { expiresAt: new Date(Date.now() - DAY) })
    await invite("b@x.co", { revokedAt: new Date() })
    await invite("c@x.co", { acceptedAt: new Date() })
    for (const email of ["a@x.co", "b@x.co", "c@x.co"]) {
      const person = await createUser(ctx.db, { name: "X", email, workspaceId: null })
      await provisionNewUser(ctx.db, person, null)
      expect(await workspacesOf(person.id)).toHaveLength(1)
    }
  })

  const onboardingOf = async (userId: string) =>
    (await ctx.db.select({ onboarding: user.onboarding }).from(user).where(eq(user.id, userId)))[0]?.onboarding

  test("a new person starts with an empty onboarding", async () => {
    const person = await createUser(ctx.db, { name: "Budi", email: "budi@ptmaju.com", workspaceId: null })
    await provisionNewUser(ctx.db, person, null)
    expect(await onboardingOf(person.id)).toEqual({})
  })

  test("an invited person starts onboarding too", async () => {
    await invite("sari@ptmaju.com")
    const person = await createUser(ctx.db, { name: "Sari", email: "sari@ptmaju.com", workspaceId: null })
    await provisionNewUser(ctx.db, person, null)
    expect(await onboardingOf(person.id)).toEqual({})
  })

  test("an existing account keeps no onboarding", async () => {
    const person = await createUser(ctx.db, { name: "Lama" })
    expect(await onboardingOf(person.id)).toBeNull()
  })

  test("signing up through Better Auth provisions the workspace", async () => {
    const outbox: EmailMessage[] = []
    const app = (await setupTestApp({}, { email: { send: async (message) => void outbox.push(message) } })).app
    const post = (path: string, body: object) =>
      app.handle(
        new Request(`http://localhost/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      )
    await post("/email-otp/send-verification-otp", { email: "new@kantor.test", type: "sign-in" })
    const code = outbox[0]?.text.match(/\b(\d{6})\b/)?.[1] ?? ""
    expect((await post("/sign-in/email-otp", { email: "new@kantor.test", otp: code })).status).toBe(200)
    const [created] = await ctx.db.select({ id: user.id }).from(user).where(eq(user.email, "new@kantor.test"))
    expect(await workspacesOf(created?.id ?? "")).toEqual([{ name: "new's workspace", role: "admin" }])
  })
})

describe("a new account on a company server", () => {
  const COMPANY = ["kantor.test"]
  const LIMITS = { screenshots: 5, recordings: 5, ownedWorkspaces: 1, recordingMs: 120_000 }

  async function domainWorkspace(name: string, domain: string, mode: "direct" | "approval") {
    const row = await createWorkspaceRow(ctx.db, name)
    await ctx.db.update(workspace).set({ joinDomain: domain, joinMode: mode }).where(eq(workspace.id, row.id))
    return row
  }

  const bareUser = (email: string) => createUser(ctx.db, { name: "ana", email, workspaceId: null })

  const lastWorkspaceOf = async (userId: string) =>
    (await ctx.db.select({ last: user.lastWorkspaceId }).from(user).where(eq(user.id, userId)))[0]?.last

  test("joins the one workspace that takes its domain, and gets none of its own", async () => {
    const acme = await domainWorkspace("Acme", "kantor.test", "direct")
    const person = await bareUser("ana@kantor.test")
    await provisionNewUser(ctx.db, person, null, COMPANY)
    expect(await workspacesOf(person.id)).toEqual([{ name: "Acme", role: "member" }])
    expect(await lastWorkspaceOf(person.id)).toBe(acme.id)
  })

  test("several workspaces for the domain: none joined, and no workspace of their own", async () => {
    await domainWorkspace("Acme", "kantor.test", "direct")
    await domainWorkspace("Acme Labs", "kantor.test", "direct")
    const person = await bareUser("ana@kantor.test")
    await provisionNewUser(ctx.db, person, null, COMPANY)
    expect(await workspacesOf(person.id)).toEqual([])
  })

  test("approval-mode workspaces are ignored: own workspace, and no join request", async () => {
    await domainWorkspace("Acme", "kantor.test", "approval")
    const person = await bareUser("ana@kantor.test")
    await provisionNewUser(ctx.db, person, null, COMPANY)
    expect(await workspacesOf(person.id)).toEqual([{ name: "ana's workspace", role: "admin" }])
    expect(await ctx.db.select().from(joinRequest)).toHaveLength(0)
  })

  test("an invitation elsewhere stays pending while the domain workspace is joined", async () => {
    await domainWorkspace("Acme", "kantor.test", "direct")
    await invite("ana@kantor.test")
    const person = await bareUser("ana@kantor.test")
    await provisionNewUser(ctx.db, person, null, COMPANY)
    expect(await workspacesOf(person.id)).toEqual([{ name: "Acme", role: "member" }])
    const pending = await ctx.db.select().from(workspaceInvitation).where(eq(workspaceInvitation.email, "ana@kantor.test"))
    expect(pending.map((row) => row.acceptedAt)).toEqual([null])
  })

  test("domains match exactly: a subdomain does not join", async () => {
    await domainWorkspace("Acme", "kantor.test", "direct")
    const person = await bareUser("ana@mail.kantor.test")
    await provisionNewUser(ctx.db, person, null, ["kantor.test", "mail.kantor.test"])
    expect(await workspacesOf(person.id)).toEqual([{ name: "ana's workspace", role: "admin" }])
  })

  test("a free-mail address never joins by domain, even when the list allows it", async () => {
    await domainWorkspace("Acme", "gmail.com", "direct")
    const person = await bareUser("ana@gmail.com")
    await provisionNewUser(ctx.db, person, null, ["gmail.com"])
    expect(await workspacesOf(person.id)).toEqual([{ name: "ana's workspace", role: "admin" }])
  })

  test("without an allow-list nothing changes", async () => {
    await domainWorkspace("Acme", "kantor.test", "direct")
    const person = await bareUser("ana@kantor.test")
    await provisionNewUser(ctx.db, person, null, [])
    expect(await workspacesOf(person.id)).toEqual([{ name: "ana's workspace", role: "admin" }])
  })

  test("a workspace under ACCOUNT_LIMITS takes nobody: the new account gets its own", async () => {
    // No owner, so under limits it counts as limited.
    await domainWorkspace("Acme", "kantor.test", "direct")
    const person = await bareUser("ana@kantor.test")
    await provisionNewUser(ctx.db, person, LIMITS, COMPANY)
    expect(await workspacesOf(person.id)).toEqual([{ name: "ana's workspace", role: "admin" }])
  })

  test("signing up through Better Auth lands in the company workspace", async () => {
    const outbox: EmailMessage[] = []
    const app = (await setupTestApp({}, { email: { send: async (message) => void outbox.push(message) } })).app
    await domainWorkspace("Acme", "kantor.test", "direct")
    const post = (path: string, body: object) =>
      app.handle(
        new Request(`http://localhost/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      )
    await post("/email-otp/send-verification-otp", { email: "new2@kantor.test", type: "sign-in" })
    const code = outbox[0]?.text.match(/\b(\d{6})\b/)?.[1] ?? ""
    expect((await post("/sign-in/email-otp", { email: "new2@kantor.test", otp: code })).status).toBe(200)
    const [created] = await ctx.db.select({ id: user.id }).from(user).where(eq(user.email, "new2@kantor.test"))
    expect(await workspacesOf(created?.id ?? "")).toEqual([{ name: "Acme", role: "member" }])
  })
})
