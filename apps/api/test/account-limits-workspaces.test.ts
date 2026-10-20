import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { user, workspace, workspaceInvitation } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { provisionNewUser } from "../src/workspaces/provision"
import { createUser, createUserWithToken, setupTestApp } from "./helpers"

const LIMITS = { screenshots: 5, recordings: 5, ownedWorkspaces: 1 }

async function setup() {
  const ctx = await setupTestApp({ accountLimits: LIMITS })
  const owned = (userId: string) => ctx.db.select({ id: workspace.id }).from(workspace).where(eq(workspace.ownerId, userId))
  const create = (headers: Record<string, string>, name = "New one") => ctx.api.api.workspaces.post({ name }, { headers })
  return { ctx, owned, create }
}

/** An owner of the test workspace, made unlimited or not. */
async function ownTestWorkspace(ctx: Awaited<ReturnType<typeof setupTestApp>>, unlimited = false) {
  const owner = await createUserWithToken(ctx.db, { role: "admin" })
  await ctx.db.update(workspace).set({ ownerId: owner.user.id }).where(eq(workspace.id, ctx.workspace.id))
  if (unlimited) await ctx.db.update(user).set({ unlimited: true }).where(eq(user.id, owner.user.id))
  return owner
}

async function inviteInto(ctx: Awaited<ReturnType<typeof setupTestApp>>, email: string) {
  await ctx.db.insert(workspaceInvitation).values({
    id: newId(),
    workspaceId: ctx.workspace.id,
    email,
    tokenHash: newId(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })
}

describe("owning workspaces", () => {
  test("an ordinary account that owns a workspace cannot create another", async () => {
    const { ctx, create } = await setup()
    const owner = await ownTestWorkspace(ctx)
    const result = await create(owner.headers)
    expect(Number(result.error?.status)).toBe(403)
    expect(result.error?.value).toMatchObject({ code: "workspace_limit_reached", message: "Your account can own 1 workspace." })
  })

  test("an account that owns none can create its first", async () => {
    const { ctx, create } = await setup()
    const member = await createUserWithToken(ctx.db, { role: "member" })
    expect((await create(member.headers)).data).toMatchObject({ name: "New one", owner: true })
  })

  test("an ordinary account already owning 2 keeps both and cannot create a third", async () => {
    const { ctx, owned, create } = await setup()
    const owner = await ownTestWorkspace(ctx)
    await ctx.db.insert(workspace).values({ id: newId(), name: "Second", ownerId: owner.user.id })
    expect(Number((await create(owner.headers)).error?.status)).toBe(403)
    expect(await owned(owner.user.id)).toHaveLength(2)
  })

  test("creating at the same time still makes only one", async () => {
    const { ctx, owned, create } = await setup()
    const member = await createUserWithToken(ctx.db, { role: "member" })
    const results = await Promise.all([create(member.headers, "A"), create(member.headers, "B"), create(member.headers, "C")])
    expect(results.filter((result) => result.data).length).toBe(1)
    expect(await owned(member.user.id)).toHaveLength(1)
  })

  test("an unlimited account creates as many as it likes", async () => {
    const { ctx, owned, create } = await setup()
    const owner = await ownTestWorkspace(ctx, true)
    expect((await create(owner.headers, "Two")).data).toBeTruthy()
    expect((await create(owner.headers, "Three")).data).toBeTruthy()
    expect(await owned(owner.user.id)).toHaveLength(3)
  })
})

describe("sign-up", () => {
  test("still provisions the first workspace", async () => {
    const { ctx, owned } = await setup()
    const person = await createUser(ctx.db, { email: "new@kantor.test", workspaceId: null })
    await provisionNewUser(ctx.db, person, LIMITS)
    expect(await owned(person.id)).toHaveLength(1)
  })

  test("a pending invitation into a limited workspace doesn't stop the new person getting their own", async () => {
    const { ctx, owned } = await setup()
    await ownTestWorkspace(ctx)
    await inviteInto(ctx, "invited@kantor.test")
    const person = await createUser(ctx.db, { email: "invited@kantor.test", workspaceId: null })
    await provisionNewUser(ctx.db, person, LIMITS)
    expect(await owned(person.id)).toHaveLength(1)
  })

  test("a pending invitation into an unlimited workspace still skips the own workspace", async () => {
    const { ctx, owned } = await setup()
    await ownTestWorkspace(ctx, true)
    await inviteInto(ctx, "invited@kantor.test")
    const person = await createUser(ctx.db, { email: "invited@kantor.test", workspaceId: null })
    await provisionNewUser(ctx.db, person, LIMITS)
    expect(await owned(person.id)).toHaveLength(0)
  })
})
