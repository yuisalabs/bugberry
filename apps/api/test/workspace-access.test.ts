import { beforeEach, describe, expect, test } from "bun:test"
import { AppError } from "../src/lib/errors"
import { memberRole, requireMember, resolveWorkspace } from "../src/modules/workspaces/access"
import { addMember, createUser, createWorkspaceRow, setupTestApp } from "./helpers"

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
})
