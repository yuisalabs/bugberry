import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { integration } from "../src/db/schema"
import { createSecretBox } from "../src/lib/secret-box"
import { TrackerError } from "../src/lib/trackers/providers"
import { createProject, createUserWithToken, type FakeTrackers, fakeTrackers, setupTestApp, TEST_ENCRYPTION_KEY } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let trackers: FakeTrackers
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string

const github = { owner: "kantor", repo: "web", labels: ["bug"] }
const activecollab = { baseUrl: "https://ac.kantor.test/", projectId: 12, taskListId: 3 }

beforeEach(async () => {
  trackers = fakeTrackers()
  ctx = await setupTestApp({}, { trackers: trackers.factory })
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  projectId = (await createProject(ctx.db)).id
})

const integrations = () => ctx.api.api.projects({ id: projectId }).integrations

async function createGithub() {
  const { data } = await integrations().post(
    { provider: "github", config: github, secret: "ghp_super-secret", autoSend: true },
    { headers: admin.headers },
  )
  if (!data) throw new Error("integration not created")
  return data
}

describe("integrations", () => {
  test("admins create integrations; the token is encrypted and never returned", async () => {
    const created = await createGithub()
    expect(created).toMatchObject({ provider: "github", config: github, autoSend: true, label: "kantor/web" })
    expect(JSON.stringify(created)).not.toContain("ghp_super-secret")

    const { data: list } = await integrations().get({ headers: admin.headers })
    expect(JSON.stringify(list)).not.toContain("ghp_super-secret")
    expect(JSON.stringify(list)).not.toContain("secretEncrypted")

    const [row] = await ctx.db.select().from(integration).where(eq(integration.id, created.id))
    expect(row?.secretEncrypted).not.toContain("ghp_super-secret")
    expect(createSecretBox(TEST_ENCRYPTION_KEY).open(row?.secretEncrypted ?? "")).toBe("ghp_super-secret")
  })

  test("members cannot manage integrations", async () => {
    const member = await createUserWithToken(ctx.db)
    const { error } = await integrations().get({ headers: member.headers })
    expect(error?.status as number | undefined).toBe(403)
  })

  test("normalises ActiveCollab URLs and rejects unsafe or malformed settings", async () => {
    const { data } = await integrations().post(
      { provider: "activecollab", config: activecollab, secret: "ac-token" },
      { headers: admin.headers },
    )
    expect(data?.config).toEqual({ baseUrl: "https://ac.kantor.test", projectId: 12, taskListId: 3 })
    expect(data?.autoSend).toBe(false)

    const plainHttp = await integrations().post(
      { provider: "activecollab", config: { ...activecollab, baseUrl: "http://ac.kantor.test" }, secret: "x" },
      { headers: admin.headers },
    )
    expect(plainHttp.error?.value).toMatchObject({ code: "invalid_base_url" })

    const badOwner = await integrations().post(
      { provider: "github", config: { ...github, owner: "-bad owner" }, secret: "x" },
      { headers: admin.headers },
    )
    expect(badOwner.error?.status as number | undefined).toBe(422)

    const missingProject = await ctx.api.api.projects({ id: "missing" }).integrations.post(
      { provider: "github", config: github, secret: "x" },
      { headers: admin.headers },
    )
    expect(missingProject.error?.status as number | undefined).toBe(404)
  })

  test("updates keep the old token unless a new one is given, and refuse another provider's config", async () => {
    const created = await createGithub()
    const item = () => integrations()({ integrationId: created.id })
    const { data } = await item().patch({ autoSend: false, config: { ...github, labels: ["bugberry"] } }, { headers: admin.headers })
    expect(data).toMatchObject({ autoSend: false, config: { labels: ["bugberry"] } })
    const [kept] = await ctx.db.select().from(integration).where(eq(integration.id, created.id))
    expect(createSecretBox(TEST_ENCRYPTION_KEY).open(kept?.secretEncrypted ?? "")).toBe("ghp_super-secret")

    await item().patch({ secret: "ghp_rotated" }, { headers: admin.headers })
    const [rotated] = await ctx.db.select().from(integration).where(eq(integration.id, created.id))
    expect(createSecretBox(TEST_ENCRYPTION_KEY).open(rotated?.secretEncrypted ?? "")).toBe("ghp_rotated")

    const wrong = await item().patch({ config: activecollab }, { headers: admin.headers })
    expect(wrong.error?.value).toMatchObject({ code: "invalid_config" })
  })

  test("blank GitHub labels are dropped instead of failing every send", async () => {
    const { data } = await integrations().post(
      { provider: "github", config: { ...github, labels: ["bug", "  ", " bugberry "] }, secret: "x" },
      { headers: admin.headers },
    )
    expect(data?.config).toMatchObject({ labels: ["bug", "bugberry"] })
  })

  test("deletes integrations", async () => {
    const created = await createGithub()
    const { data } = await integrations()({ integrationId: created.id }).delete(undefined, { headers: admin.headers })
    expect(data).toEqual({ ok: true })
    expect((await integrations().get({ headers: admin.headers })).data).toEqual([])
  })

  test("tests the connection with the decrypted token", async () => {
    const created = await createGithub()
    const check = () => integrations()({ integrationId: created.id }).test.post(undefined, { headers: admin.headers })
    expect((await check()).data).toEqual({ ok: true })
    expect(trackers.tests[0]).toMatchObject({ provider: "github", secret: "ghp_super-secret" })

    trackers.behaviour.test = async () => {
      throw new TrackerError("The repo was not found or the token lacks Issues permission")
    }
    const failed = await check()
    expect(failed.error?.status as number | undefined).toBe(422)
    expect(failed.error?.value).toMatchObject({
      code: "integration_test_failed",
      message: "The repo was not found or the token lacks Issues permission",
    })
  })

  test("a token that can no longer be decrypted asks for it to be saved again", async () => {
    const created = await createGithub()
    await ctx.db.update(integration).set({ secretEncrypted: "v1.aaa.bbb.ccc" }).where(eq(integration.id, created.id))
    const { error } = await integrations()({ integrationId: created.id }).test.post(undefined, { headers: admin.headers })
    expect(error?.status as number | undefined).toBe(409)
    expect(error?.value).toMatchObject({ code: "secret_unreadable" })
  })
})
