import { beforeEach, describe, expect, test } from "bun:test"
import { eq, inArray } from "drizzle-orm"
import { workspace } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { provisionNewUser } from "../src/modules/workspaces/provision"
import { ensureWorkspaceSlugs, RESERVED_SLUGS, SLUG_PATTERN, slugify, slugProblem } from "../src/modules/workspaces/slug"
import { createUser, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let owner: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  ctx = await setupTestApp()
  owner = await createUserWithToken(ctx.db, { name: "Owner", workspaceId: null })
})

const create = (body: { name: string; slug?: string }) => ctx.api.api.workspaces.post(body, { headers: owner.headers })
const check = (query: { name?: string; slug?: string; except?: string }) =>
  ctx.api.api.workspaces.slug.get({ query, headers: owner.headers })

describe("slugify", () => {
  test("slugify", () => {
    expect(slugify("Javan QA")).toBe("javan-qa")
    expect(slugify("Café Ünïcode!")).toBe("cafe-unicode")
    expect(slugify("QA")).toBe("qa-workspace")
    expect(slugify("App")).toBe("app-workspace")
    expect(slugify("!!!")).toBe("workspace")
    const long = slugify("x".repeat(120))
    expect(long.length).toBeLessThanOrEqual(36)
    expect(long).toMatch(SLUG_PATTERN)
  })

  test("slug rules", () => {
    expect(slugProblem("ab")).toBe("invalid")
    expect(slugProblem("-qa")).toBe("invalid")
    expect(slugProblem("Qa")).toBe("invalid")
    expect(slugProblem("api")).toBe("reserved")
    expect(slugProblem("javan-qa")).toBeNull()
  })
})

describe("workspace slugs", () => {
  test("the modal's suggestion is always free", async () => {
    await create({ name: "Javan QA" })
    expect((await check({ name: "Javan QA" })).data).toEqual({ slug: "javan-qa-2", available: true, reason: null })
    expect((await check({ slug: "javan-qa" })).data).toEqual({ slug: "javan-qa", available: false, reason: "taken" })
    expect((await check({ slug: "api" })).data).toMatchObject({ available: false, reason: "reserved" })
    expect((await check({ slug: "x" })).data).toMatchObject({ available: false, reason: "invalid" })
  })

  test("creating with a typed slug", async () => {
    await create({ name: "Javan QA" })
    const taken = await create({ name: "X", slug: "javan-qa" })
    expect(taken.error?.status as number | undefined).toBe(409)
    expect(taken.error?.value).toMatchObject({ code: "slug_taken" })
    const invalid = await create({ name: "X", slug: "API" })
    expect(invalid.error?.status as number | undefined).toBe(422)
    const { data } = await create({ name: "X", slug: "my-team" })
    expect(data?.slug).toBe("my-team")
    const listed = (await ctx.api.api.workspaces.get({ headers: owner.headers })).data?.find((row) => row.id === data?.id)
    expect(listed?.slug).toBe("my-team")
  })

  test("a slug collision from two creates never fails both", async () => {
    const [a, b] = await Promise.all([create({ name: "Same" }), create({ name: "Same" })])
    expect([a.error, b.error]).toEqual([null, null])
    expect([a.data?.slug, b.data?.slug].sort()).toEqual(["same", "same-2"])
  })

  test("renaming keeps the slug, and admins change it", async () => {
    const id = (await create({ name: "Old name" })).data?.id ?? ""
    const settings = ctx.api.api.workspaces({ id })
    expect((await settings.patch({ name: "New" }, { headers: owner.headers })).data).toMatchObject({ name: "New", slug: "old-name" })
    expect((await settings.patch({ slug: "fresh" }, { headers: owner.headers })).data).toMatchObject({ slug: "fresh" })
    const member = await createUserWithToken(ctx.db, { workspaceId: id, workspaceRole: "member" })
    const denied = await settings.patch({ slug: "mine" }, { headers: member.headers })
    expect(denied.error?.status as number | undefined).toBe(403)
  })

  test("old workspaces get valid, unique slugs once", async () => {
    const names = ["", "!!!", "QA", "App", "x".repeat(120), "Dup", "Dup"]
    const ids = names.map(() => newId())
    for (const [index, name] of names.entries()) {
      await ctx.db.insert(workspace).values({ id: ids[index] as string, name, slug: null })
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    expect(await ensureWorkspaceSlugs(ctx.db)).toBe(7)
    const rows = await ctx.db.select({ id: workspace.id, slug: workspace.slug }).from(workspace).where(inArray(workspace.id, ids))
    const slugs = ids.map((id) => rows.find((row) => row.id === id)?.slug ?? "")
    for (const slug of slugs) {
      expect(slug).toMatch(SLUG_PATTERN)
      expect(RESERVED_SLUGS.has(slug)).toBe(false)
    }
    expect(new Set(slugs).size).toBe(7)
    expect(slugs.slice(5)).toEqual(["dup", "dup-2"])
    expect(await ensureWorkspaceSlugs(ctx.db)).toBe(0)
  })

  test("auto-created workspaces get a slug", async () => {
    const budi = await createUser(ctx.db, { name: "Budi", workspaceId: null })
    await provisionNewUser(ctx.db, { id: budi.id, name: "Budi", email: budi.email }, null)
    const [row] = await ctx.db.select({ slug: workspace.slug }).from(workspace).where(eq(workspace.ownerId, budi.id))
    expect(row?.slug).toBe("budi-s-workspace")
  })
})
