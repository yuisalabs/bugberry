import { beforeEach, describe, expect, test } from "bun:test"
import { WORKSPACE_ROLES } from "@bugberry/shared"
import { sql } from "drizzle-orm"
import { addGuest, createProject, createUser, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>


const count = async (query: ReturnType<typeof sql>) =>
  ((await ctx.db.execute(query)) as unknown as Array<{ n: number }>)[0]?.n ?? -1

describe("the tables", () => {
  beforeEach(async () => {
    ctx = await setupTestApp()
  })

test("a guest row goes with its project and with its user", async () => {
  const project = await createProject(ctx.db)
  const other = await createProject(ctx.db)
  const guest = await createUser(ctx.db, { workspaceId: null })
  const second = await createUser(ctx.db, { workspaceId: null })
  await addGuest(ctx.db, project.id, guest.id)
  await addGuest(ctx.db, other.id, second.id)
  await ctx.db.execute(sql`DELETE FROM project WHERE id = ${project.id}`)
  expect(await count(sql`SELECT count(*)::int AS n FROM project_guest WHERE user_id = ${guest.id}`)).toBe(0)
  await ctx.db.execute(sql`DELETE FROM "user" WHERE id = ${second.id}`)
  expect(await count(sql`SELECT count(*)::int AS n FROM project_guest`)).toBe(0)
})

test("an invitation can name a project and goes with it", async () => {
  const project = await createProject(ctx.db)
  await ctx.db.execute(sql`INSERT INTO workspace_invitation (id, workspace_id, email, token_hash, expires_at, guest_project_id)
    VALUES ('inv1', ${ctx.workspace.id}, 'client@acme.test', 'hash1', now() + interval '1 day', ${project.id})`)
  await ctx.db.execute(sql`DELETE FROM project WHERE id = ${project.id}`)
  expect(await count(sql`SELECT count(*)::int AS n FROM workspace_invitation WHERE id = 'inv1'`)).toBe(0)
})

})

test("workspace roles are still admin and member", () => {
  expect([...WORKSPACE_ROLES]).toEqual(["admin", "member"])
})
