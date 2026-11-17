import { beforeEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { eq, sql } from "drizzle-orm"
import { user } from "../src/db/schema"
import { addGuest, createProject, createUser, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const backfill = readFileSync(new URL("../drizzle/0041_last_member_workspace.sql", import.meta.url), "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .find((statement) => statement.startsWith("UPDATE")) as string

const lastMember = async (userId: string) =>
  (await ctx.db.select({ id: user.lastMemberWorkspaceId }).from(user).where(eq(user.id, userId)))[0]?.id ?? null

test("0041 copies the current workspace where the person is a member, and nowhere else", async () => {
  const member = await createUser(ctx.db)
  const hosted = await createWorkspaceRow(ctx.db, "Hosted")
  const storefront = await createProject(ctx.db, { name: "Storefront", workspaceId: hosted.id })
  const guest = await createUser(ctx.db)
  await addGuest(ctx.db, storefront.id, guest.id)
  await ctx.db.update(user).set({ lastWorkspaceId: hosted.id, lastMemberWorkspaceId: null }).where(eq(user.id, guest.id))
  await ctx.db.update(user).set({ lastMemberWorkspaceId: null }).where(eq(user.id, member.id))

  await ctx.db.execute(sql.raw(backfill))

  expect(await lastMember(member.id)).toBe(ctx.workspace.id)
  expect(await lastMember(guest.id)).toBeNull()
})
