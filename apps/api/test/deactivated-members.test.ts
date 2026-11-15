import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { deactivateUser } from "../src/admin/deactivate-user"
import { report, workspaceMember } from "../src/db/schema"
import type { AppDeps } from "../src/deps"
import type { EmailMessage } from "../src/lib/email/sender"
import { resolveReport } from "../src/modules/reports/fixes"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let gone: Awaited<ReturnType<typeof createUserWithToken>>
let sent: EmailMessage[]
let tasks: Promise<unknown>[]
let deps: AppDeps

beforeEach(async () => {
  sent = []
  tasks = []
  const email = { send: async (message: EmailMessage) => void sent.push(message) }
  const background = (task: Promise<unknown>) => void tasks.push(task)
  ctx = await setupTestApp({}, { background, email })
  deps = { ...ctx, email, background }
  admin = await createUserWithToken(ctx.db, { name: "Ana", email: "ana@kantor.test", role: "admin" })
  gone = await createUserWithToken(ctx.db, { name: "Gone", email: "gone@kantor.test" })
})

const status = (result: { error: { status: unknown } | null }) => result.error?.status as number | undefined
const members = () => ctx.api.api.workspaces({ id: ctx.workspace.id }).members

describe("deactivated people in a workspace", () => {
  test("the member list leaves them out unless asked", async () => {
    await deactivateUser(ctx.db, gone.user.email)
    const shown = (await members().get({ headers: admin.headers })).data ?? []
    expect(shown.map((member) => member.email)).toEqual(["ana@kantor.test"])
    expect(shown.every((member) => member.deactivated === false)).toBe(true)
    const all = (await members().get({ headers: admin.headers, query: { include: "deactivated" } })).data ?? []
    expect(all.map((member) => [member.email, member.deactivated])).toEqual([
      ["ana@kantor.test", false],
      ["gone@kantor.test", true],
    ])
  })

  test("an admin can still remove them from the workspace", async () => {
    await deactivateUser(ctx.db, gone.user.email)
    const removed = await members()({ userId: gone.user.id }).delete(undefined, { headers: admin.headers })
    expect(status(removed)).toBeUndefined()
    expect(await ctx.db.select().from(workspaceMember).where(eq(workspaceMember.userId, gone.user.id))).toHaveLength(0)
  })

  test("a report can't be assigned to them, and an old assignment stays", async () => {
    const old = await createReadyReport(ctx.db, { reporterId: admin.user.id, assigneeId: gone.user.id })
    const fresh = await createReadyReport(ctx.db, { reporterId: admin.user.id })
    await deactivateUser(ctx.db, gone.user.email)
    const refused = await ctx.api.api.reports({ id: fresh.id }).patch({ assigneeId: gone.user.id }, { headers: admin.headers })
    expect(status(refused)).toBe(422)
    expect(refused.error?.value).toMatchObject({ code: "assignee_deactivated" })
    const [kept] = await ctx.db.select({ assigneeId: report.assigneeId }).from(report).where(eq(report.id, old.id))
    expect(kept?.assigneeId).toBe(gone.user.id)
    const detail = await ctx.api.api.reports({ id: old.id }).get({ headers: admin.headers })
    expect(detail.data?.assignee).toMatchObject({ id: gone.user.id, name: "Gone" })
  })

  test("a mention sends them no email", async () => {
    const target = await createReadyReport(ctx.db, { reporterId: admin.user.id })
    await deactivateUser(ctx.db, gone.user.email)
    await ctx.api.api.reports({ id: target.id }).comments.post({ body: `@[user:${gone.user.id}] please look` }, { headers: admin.headers })
    await Promise.all(tasks)
    expect(sent).toHaveLength(0)
  })

  test("resolving their report sends them no email", async () => {
    const theirs = await createReadyReport(ctx.db, { reporterId: gone.user.id })
    await deactivateUser(ctx.db, gone.user.email)
    await resolveReport(deps, admin.user, theirs.id, { links: ["https://github.com/shop/web/pull/42"] })
    await Promise.all(tasks)
    expect(sent).toHaveLength(0)
  })

  test("MCP's listMembers leaves them out", async () => {
    await deactivateUser(ctx.db, gone.user.email)
    const client = await mcpClient(ctx.app, admin.headers)
    const { text } = await callTool(client, "listMembers")
    expect(text).toContain("Ana <ana@kantor.test>")
    expect(text).not.toContain("gone@kantor.test")
  })
})
