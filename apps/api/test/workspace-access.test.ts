import { beforeEach, describe, expect, test } from "bun:test"
import { AppError } from "../src/lib/errors"
import { and, eq } from "drizzle-orm"
import { user, workspaceMember } from "../src/db/schema"
import { memberRole, requireMember, requireScope, resolveWorkspace } from "../src/modules/workspaces/access"
import { addGuest, addMember, createProject, createUser, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof AppError ? { status: error.status, code: error.code } : error),
  )

describe("requireMember", () => {
  test("an outsider gets 404, a member needing admin gets 403", async () => {
    const outsider = await createUser(ctx.db, { workspaceId: null })
    const member = await createUser(ctx.db)
    const admin = await createUser(ctx.db, { workspaceRole: "admin" })
    expect(await failure(requireMember(ctx.db, outsider.id, ctx.workspace.id))).toEqual({ status: 404, code: "workspace_not_found" })
    expect(await failure(requireMember(ctx.db, member.id, ctx.workspace.id, "admin"))).toEqual({ status: 403, code: "forbidden" })
    expect(await requireMember(ctx.db, member.id, ctx.workspace.id)).toBe("member")
    expect(await requireMember(ctx.db, admin.id, ctx.workspace.id, "admin")).toBe("admin")
    expect(await memberRole(ctx.db, outsider.id, ctx.workspace.id)).toBeNull()
  })
})

describe("resolveWorkspace", () => {
  test("requested, then a still-valid last workspace, then the oldest membership, then none", async () => {
    const other = await createWorkspaceRow(ctx.db, "Other")
    const person = await createUser(ctx.db)
    await addMember(ctx.db, other.id, person.id)

    expect(await resolveWorkspace(ctx.db, { id: person.id, lastWorkspaceId: ctx.workspace.id }, other.id)).toBe(other.id)
    expect(await resolveWorkspace(ctx.db, { id: person.id, lastWorkspaceId: other.id })).toBe(other.id)
    // A last workspace the person has left falls back to the oldest membership.
    const gone = await createWorkspaceRow(ctx.db, "Gone")
    expect(await resolveWorkspace(ctx.db, { id: person.id, lastWorkspaceId: gone.id })).toBe(ctx.workspace.id)
    expect(await failure(resolveWorkspace(ctx.db, { id: person.id }, gone.id))).toEqual({ status: 404, code: "workspace_not_found" })

    const lonely = await createUser(ctx.db, { workspaceId: null })
    expect(await failure(resolveWorkspace(ctx.db, { id: lonely.id, lastWorkspaceId: null }))).toEqual({
      status: 409,
      code: "no_workspace",
    })
  })

  test("with a guest workspace open, the last workspace used as a member, not the oldest", async () => {
    const newer = await createWorkspaceRow(ctx.db, "Newer")
    const hosted = await createWorkspaceRow(ctx.db, "Hosted")
    const storefront = await createProject(ctx.db, { name: "Storefront", workspaceId: hosted.id })
    const person = await createUserWithToken(ctx.db)
    await addMember(ctx.db, newer.id, person.user.id)
    await addGuest(ctx.db, storefront.id, person.user.id)
    const open = (workspaceId: string) =>
      ctx.app.handle(
        new Request("http://localhost/api/me/workspace", {
          method: "PUT",
          headers: { ...person.headers, "content-type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        }),
      )
    expect((await open(newer.id)).status).toBe(200)
    expect((await open(hosted.id)).status).toBe(200)
    const me = { id: person.user.id, lastWorkspaceId: hosted.id }
    expect(await resolveWorkspace(ctx.db, me)).toBe(newer.id)
    expect((await requireScope(ctx.db, me)).workspaceId).toBe(hosted.id)
  })

  test("a last member workspace since left falls back to the oldest membership", async () => {
    const newer = await createWorkspaceRow(ctx.db, "Newer")
    const person = await createUser(ctx.db)
    await addMember(ctx.db, newer.id, person.id)
    await ctx.db.update(user).set({ lastMemberWorkspaceId: newer.id }).where(eq(user.id, person.id))
    await ctx.db.delete(workspaceMember).where(and(eq(workspaceMember.workspaceId, newer.id), eq(workspaceMember.userId, person.id)))
    expect(await resolveWorkspace(ctx.db, { id: person.id, lastWorkspaceId: null })).toBe(ctx.workspace.id)
  })
})
