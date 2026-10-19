import { beforeEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { and, eq, sql } from "drizzle-orm"
import { workspace, workspaceMember } from "../src/db/schema"
import { addMember, createUser, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url))

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let owner: Awaited<ReturnType<typeof createUserWithToken>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let workspaceId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  owner = await createUserWithToken(ctx.db, { name: "Owner", workspaceId: null })
  admin = await createUserWithToken(ctx.db, { name: "Admin", workspaceId: null })
  workspaceId = (await ctx.api.api.workspaces.post({ name: "Javan QA" }, { headers: owner.headers })).data?.id ?? ""
  await addMember(ctx.db, workspaceId, admin.user.id, "admin")
})

const members = () => ctx.api.api.workspaces({ id: workspaceId }).members
const memberRow = async (userId: string) =>
  (
    await ctx.db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
  )[0]

describe("workspace owner", () => {
  test("the creator of a workspace is its owner", async () => {
    const mine = (await ctx.api.api.workspaces.get({ headers: owner.headers })).data?.find((row) => row.id === workspaceId)
    expect(mine).toMatchObject({ role: "admin", owner: true })
    const theirs = (await ctx.api.api.workspaces.get({ headers: admin.headers })).data?.find((row) => row.id === workspaceId)
    expect(theirs).toMatchObject({ role: "admin", owner: false })
    const rows = (await members().get({ headers: admin.headers })).data ?? []
    expect(rows.map((row) => [row.name, row.owner])).toEqual([
      ["Admin", false],
      ["Owner", true],
    ])
  })

  test("the owner can't be demoted, removed or leave", async () => {
    const demote = await members()({ userId: owner.user.id }).patch({ role: "member" }, { headers: admin.headers })
    expect(demote.error?.status as number | undefined).toBe(409)
    expect(demote.error?.value).toMatchObject({ code: "owner_protected" })
    const remove = await members()({ userId: owner.user.id }).delete(undefined, { headers: admin.headers })
    expect(remove.error?.value).toMatchObject({ code: "owner_protected" })
    const leave = await members()({ userId: owner.user.id }).delete(undefined, { headers: owner.headers })
    expect(leave.error?.status as number | undefined).toBe(409)
    expect(leave.error?.value).toMatchObject({ code: "owner_cannot_leave", message: "The workspace owner can't leave the workspace" })
    expect(await memberRow(owner.user.id)).toEqual({ role: "admin" })
  })

  test("the owner keeps every admin power", async () => {
    const { error } = await ctx.api.api.workspaces({ id: workspaceId }).invitations.post(
      { emails: ["baru@kantor.test"] },
      { headers: owner.headers },
    )
    expect(error).toBeNull()
  })

  test("the migration makes the earliest admin the owner", async () => {
    const both = await createWorkspaceRow(ctx.db, "Two admins")
    const first = await createUser(ctx.db, { workspaceId: both.id, workspaceRole: "admin" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await createUser(ctx.db, { workspaceId: both.id, workspaceRole: "admin" })
    const solo = await createWorkspaceRow(ctx.db, "One admin")
    const member = await createUser(ctx.db, { workspaceId: solo.id, workspaceRole: "member" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const only = await createUser(ctx.db, { workspaceId: solo.id, workspaceRole: "admin" })
    await ctx.db.update(workspace).set({ ownerId: null })

    const file = readdirSync(drizzleDir).find((name) => name.endsWith("_workspace_owner.sql"))
    expect(file).toBeDefined()
    const statements = readFileSync(`${drizzleDir}/${file}`, "utf8").split("--> statement-breakpoint")
    const backfill = statements.filter((statement) => statement.includes('UPDATE "workspace"'))
    expect(backfill).toHaveLength(1)
    await ctx.db.execute(sql.raw(backfill[0] as string))

    const ownerOf = async (id: string) => (await ctx.db.select({ ownerId: workspace.ownerId }).from(workspace).where(eq(workspace.id, id)))[0]?.ownerId
    expect(await ownerOf(both.id)).toBe(first.id)
    expect(await ownerOf(solo.id)).toBe(only.id)
    expect([second.id, member.id]).not.toContain((await ownerOf(both.id)) ?? "")
    expect(await ownerOf(workspaceId)).toBe(owner.user.id)
  })
})
