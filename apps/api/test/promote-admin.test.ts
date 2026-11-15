import { beforeEach, describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { deactivateUser } from "../src/admin/deactivate-user"
import { promoteAdmin } from "../src/admin/promote-admin"
import { workspace, workspaceMember } from "../src/db/schema"
import { createUser, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let slug: string

beforeEach(async () => {
  ctx = await setupTestApp()
  slug = ctx.workspace.slug ?? ""
})

const roleOf = async (userId: string) =>
  (
    await ctx.db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, ctx.workspace.id), eq(workspaceMember.userId, userId)))
  )[0]?.role

const ownerOf = async () => (await ctx.db.select({ ownerId: workspace.ownerId }).from(workspace).where(eq(workspace.id, ctx.workspace.id)))[0]?.ownerId

describe("promoteAdmin", () => {
  test("a member becomes an admin", async () => {
    const budi = await createUser(ctx.db, { email: "budi@kantor.test", role: "member" })
    expect(await promoteAdmin(ctx.db, slug, " Budi@Kantor.test ")).toEqual({ workspace: "Test", email: "budi@kantor.test", added: false })
    expect(await roleOf(budi.id)).toBe("admin")
  })

  test("someone outside the workspace is added as an admin", async () => {
    const cici = await createUser(ctx.db, { email: "cici@kantor.test", workspaceId: null })
    expect(await promoteAdmin(ctx.db, slug, "cici@kantor.test")).toMatchObject({ added: true })
    expect(await roleOf(cici.id)).toBe("admin")
  })

  test("the workspace can be named by its id, for one without a URL name", async () => {
    await ctx.db.update(workspace).set({ slug: null }).where(eq(workspace.id, ctx.workspace.id))
    const budi = await createUser(ctx.db, { email: "budi@kantor.test", role: "admin" })
    const stranded = (await deactivateUser(ctx.db, budi.email)).withoutAdmin
    expect(stranded).toEqual([{ name: "Test", ref: ctx.workspace.id }])
    await createUser(ctx.db, { email: "cici@kantor.test" })
    expect(await promoteAdmin(ctx.db, stranded[0]?.ref ?? "", "cici@kantor.test")).toMatchObject({ workspace: "Test" })
  })

  test("the owner does not change", async () => {
    const owner = await createUser(ctx.db, { role: "admin" })
    await ctx.db.update(workspace).set({ ownerId: owner.id }).where(eq(workspace.id, ctx.workspace.id))
    await createUser(ctx.db, { email: "budi@kantor.test" })
    await promoteAdmin(ctx.db, slug, "budi@kantor.test")
    expect(await ownerOf()).toBe(owner.id)
  })

  test("unknown workspace, unknown email and a deactivated account are errors", async () => {
    const dedi = await createUser(ctx.db, { email: "dedi@kantor.test" })
    await deactivateUser(ctx.db, dedi.email)
    await expect(promoteAdmin(ctx.db, "nope", "dedi@kantor.test")).rejects.toThrow("No workspace with the URL nope")
    await expect(promoteAdmin(ctx.db, slug, "x@kantor.test")).rejects.toThrow("No account with the email x@kantor.test")
    await expect(promoteAdmin(ctx.db, slug, "dedi@kantor.test")).rejects.toThrow("dedi@kantor.test is deactivated")
    expect(await roleOf(dedi.id)).toBe("member")
  })
})
