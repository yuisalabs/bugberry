import { beforeEach, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { project, workspace } from "../src/db/schema"
import type { EmailMessage } from "../src/lib/email/sender"
import { isProjectGuest } from "../src/modules/guests/repository"
import { findMemberRole } from "../src/modules/workspaces/repository"
import { addGuest, createProject, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let outbox: EmailMessage[]
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let p1: { id: string }

type Who = { headers: Record<string, string> }
const call = (method: string, path: string, who: Who, body?: unknown) =>
  ctx.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...who.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
const json = async (response: Response) => (await response.json()) as any
const invite = (who: Who, projectId: string, emails: string[]) => call("POST", `/api/projects/${projectId}/guests`, who, { emails })
const tokenIn = (message: EmailMessage | undefined) => message?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1] ?? ""
const acceptAs = (who: Who, token: string) => call("POST", `/api/invitations/${token}/accept`, who)

async function setup(overrides: Parameters<typeof setupTestApp>[0] = {}) {
  outbox = []
  ctx = await setupTestApp({ allowedEmailDomains: [], ...overrides }, { email: { send: async (message) => void outbox.push(message) } })
  admin = await createUserWithToken(ctx.db, { role: "admin", name: "Admin", email: "admin@team.test" })
  member = await createUserWithToken(ctx.db, { role: "member", name: "Member", email: "ana@team.test" })
  p1 = await createProject(ctx.db, { name: "Storefront" })
}

beforeEach(() => setup())

describe("inviting a guest", () => {
  test("an admin invites a guest; accepting makes a guest, not a member", async () => {
    expect(await json(await invite(admin, p1.id, ["Client@Acme.test"]))).toEqual([{ email: "client@acme.test", status: "sent" }])
    const client = await createUserWithToken(ctx.db, { workspaceId: null, email: "client@acme.test", name: "Client" })
    expect((await acceptAs(client, tokenIn(outbox[0]))).status).toBe(200)
    expect(await isProjectGuest(ctx.db, client.user.id, p1.id)).toBe(true)
    expect(await findMemberRole(ctx.db, client.user.id, ctx.workspace.id)).toBeNull()
  })

  test("the email names the project and says guest", async () => {
    await invite(admin, p1.id, ["client@acme.test"])
    expect(outbox[0]?.subject).toContain("Storefront")
    expect(outbox[0]?.text).toContain("as a guest")
    expect(outbox[0]?.text).toContain("Storefront")
  })

  test("a member can't invite guests; an outsider gets 404", async () => {
    expect((await invite(member, p1.id, ["client@acme.test"])).status).toBe(403)
    const other = await createWorkspaceRow(ctx.db, "Elsewhere")
    const outsider = await createUserWithToken(ctx.db, { workspaceId: other.id, role: "admin" })
    expect((await invite(outsider, p1.id, ["client@acme.test"])).status).toBe(404)
    expect(outbox).toEqual([])
  })

  test("inviting a member answers member and sends nothing", async () => {
    expect(await json(await invite(admin, p1.id, ["ana@team.test"]))).toEqual([{ email: "ana@team.test", status: "member" }])
    expect(outbox).toEqual([])
  })

  test("inviting someone already a guest answers guest; inviting twice answers pending", async () => {
    const client = await createUserWithToken(ctx.db, { workspaceId: null, email: "client@acme.test" })
    await addGuest(ctx.db, p1.id, client.user.id)
    expect(await json(await invite(admin, p1.id, ["client@acme.test"]))).toEqual([{ email: "client@acme.test", status: "guest" }])
    await invite(admin, p1.id, ["other@acme.test"])
    expect(await json(await invite(admin, p1.id, ["other@acme.test"]))).toEqual([{ email: "other@acme.test", status: "pending" }])
  })

  test("with ALLOWED_EMAIL_DOMAINS, an address outside it is not_allowed", async () => {
    await setup({ allowedEmailDomains: ["team.test"] })
    expect(await json(await invite(admin, p1.id, ["client@acme.test"]))).toEqual([{ email: "client@acme.test", status: "not_allowed" }])
  })

  test("the 51st guest is refused, pending invitations counted", async () => {
    const guests = Array.from({ length: 30 }, (_, i) => `g${i}@acme.test`)
    for (const email of guests) {
      const user = await createUserWithToken(ctx.db, { workspaceId: null, email })
      await addGuest(ctx.db, p1.id, user.user.id)
    }
    expect((await invite(admin, p1.id, Array.from({ length: 20 }, (_, i) => `p${i}@acme.test`))).status).toBe(200)
    const over = await invite(admin, p1.id, ["one-more@acme.test"])
    expect(over.status).toBe(422)
    expect((await json(over)).code).toBe("guest_limit")
  })

  test("guests don't count toward the member limit", async () => {
    await setup({ accountLimits: { screenshots: 5, recordings: 5, ownedWorkspaces: 1, recordingMs: 120_000 } })
    await ctx.db.update(workspace).set({ ownerId: admin.user.id }).where(eq(workspace.id, ctx.workspace.id))
    expect((await call("POST", `/api/workspaces/${ctx.workspace.id}/invitations`, admin, { emails: ["new@team.test"] })).status).toBe(403)
    expect(await json(await invite(admin, p1.id, ["client@acme.test"]))).toEqual([{ email: "client@acme.test", status: "sent" }])
  })

  test("the guest list shows guests and pending invitations; the members' invitation list doesn't", async () => {
    const client = await createUserWithToken(ctx.db, { workspaceId: null, email: "client@acme.test", name: "Client" })
    await addGuest(ctx.db, p1.id, client.user.id)
    await invite(admin, p1.id, ["later@acme.test"])
    const list = await json(await call("GET", `/api/projects/${p1.id}/guests`, admin))
    expect(list.guests).toMatchObject([{ id: client.user.id, name: "Client", email: "client@acme.test" }])
    expect(list.pending).toMatchObject([{ email: "later@acme.test" }])
    expect(await json(await call("GET", `/api/workspaces/${ctx.workspace.id}/invitations`, admin))).toEqual([])
    expect((await call("GET", `/api/projects/${p1.id}/guests`, member)).status).toBe(403)
  })

  test("removing a guest ends their access; removing them twice is 404", async () => {
    const client = await createUserWithToken(ctx.db, { workspaceId: null, email: "client@acme.test" })
    await addGuest(ctx.db, p1.id, client.user.id)
    expect((await call("DELETE", `/api/projects/${p1.id}/guests/${client.user.id}`, admin)).status).toBe(200)
    expect(await isProjectGuest(ctx.db, client.user.id, p1.id)).toBe(false)
    const again = await call("DELETE", `/api/projects/${p1.id}/guests/${client.user.id}`, admin)
    expect(again.status).toBe(404)
    expect((await json(again)).code).toBe("guest_not_found")
  })

  test("a guest who joins as a member has no guest rows left", async () => {
    const client = await createUserWithToken(ctx.db, { workspaceId: null, email: "client@team.test" })
    await addGuest(ctx.db, p1.id, client.user.id)
    await call("POST", `/api/workspaces/${ctx.workspace.id}/invitations`, admin, { emails: ["client@team.test"] })
    expect((await acceptAs(client, tokenIn(outbox.at(-1)))).status).toBe(200)
    expect(await findMemberRole(ctx.db, client.user.id, ctx.workspace.id)).toBe("member")
    expect(await isProjectGuest(ctx.db, client.user.id, p1.id)).toBe(false)
  })

  test("a member who accepts a guest invitation stays a member and gains no guest row", async () => {
    await invite(admin, p1.id, ["late@team.test"])
    const late = await createUserWithToken(ctx.db, { role: "member", email: "late@team.test" })
    expect((await acceptAs(late, tokenIn(outbox[0]))).status).toBe(200)
    expect(await isProjectGuest(ctx.db, late.user.id, p1.id)).toBe(false)
  })

  test("a guest invitation for a deleted project is gone", async () => {
    await invite(admin, p1.id, ["client@acme.test"])
    await ctx.db.delete(project).where(eq(project.id, p1.id))
    const client = await createUserWithToken(ctx.db, { workspaceId: null, email: "client@acme.test" })
    expect((await acceptAs(client, tokenIn(outbox[0]))).status).toBe(404)
    const [row] = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM project_guest`)) as unknown as Array<{ n: number }>
    expect(row?.n).toBe(0)
  })
})

test("members see how many guests each project has; a guest sees none", async () => {
  const client = await createUserWithToken(ctx.db, { workspaceId: null, email: "client@acme.test" })
  await addGuest(ctx.db, p1.id, client.user.id)
  const asMember = await json(await call("GET", `/api/projects?workspaceId=${ctx.workspace.id}`, member))
  expect(asMember.find((row: { id: string }) => row.id === p1.id).guestCount).toBe(1)
  const asGuest = await json(await call("GET", `/api/projects?workspaceId=${ctx.workspace.id}`, client))
  expect(asGuest).toMatchObject([{ id: p1.id, guestCount: 0 }])
})
