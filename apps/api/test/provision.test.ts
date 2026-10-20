import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { user, workspace, workspaceInvitation, workspaceMember } from "../src/db/schema"
import type { EmailMessage } from "../src/email/sender"
import { newId } from "../src/lib/ids"
import { defaultWorkspaceName, provisionNewUser } from "../src/workspaces/provision"
import { createUser, setupTestApp } from "./helpers"

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
