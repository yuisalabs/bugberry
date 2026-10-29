import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { templateFor } from "../src/modules/ai/setup"
import { project, reportTemplate, workspaceAiProvider } from "../src/db/schema"
import { createSecretBox } from "../src/lib/secret-box"
import { createProject, createUserWithToken, setupTestApp, TEST_ENCRYPTION_KEY } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let member: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  ctx = await setupTestApp()
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  member = await createUserWithToken(ctx.db)
})

const ai = () => ctx.api.api.workspaces({ id: ctx.workspace.id }).ai

async function storeTeamKey() {
  await ctx.db.insert(workspaceAiProvider).values({
    workspaceId: ctx.workspace.id,
    preset: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    keyEncrypted: createSecretBox(TEST_ENCRYPTION_KEY).seal("sk-live-1234a1b2"),
    keyHint: "sk-…a1b2",
  })
}

describe("GET /workspaces/:id/ai", () => {
  test("the first read seeds the two built-in templates once and makes the first the default", async () => {
    const first = await ai().get({ headers: member.headers })
    expect(first.status).toBe(200)
    expect(first.data?.templates.map((template) => template.name)).toEqual(["Steps to reproduce", "Short"])
    expect(first.data?.defaultTemplateId).toBe(first.data?.templates[0]?.id ?? "missing")
    expect(first.data?.sendResponseBodies).toBe(false)
    expect(first.data?.role).toBe("member")
    expect((await ai().get({ headers: member.headers })).data?.templates).toHaveLength(2)
    await ctx.db.delete(reportTemplate).where(eq(reportTemplate.workspaceId, ctx.workspace.id))
    const after = await ai().get({ headers: member.headers })
    expect(after.data?.templates).toEqual([])
    expect(after.data?.defaultTemplateId).toBeNull()
  })

  test("without a team key, nobody sees one configured", async () => {
    expect((await ai().get({ headers: admin.headers })).data?.team).toEqual({ configured: false })
  })

  test("members see that a team key exists but not its address, model or hint", async () => {
    await storeTeamKey()
    expect((await ai().get({ headers: member.headers })).data?.team).toEqual({ configured: true })
    const seen = (await ai().get({ headers: admin.headers })).data?.team
    expect(seen).toEqual({ configured: true, preset: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", keyHint: "sk-…a1b2" })
    expect(JSON.stringify(seen)).not.toContain("1234a1b2")
  })

  test("lists each project's default template", async () => {
    const setup = (await ai().get({ headers: admin.headers })).data!
    const web = await createProject(ctx.db, { name: "Web" })
    await ctx.db.update(project).set({ aiTemplateId: setup.templates[1]!.id }).where(eq(project.id, web.id))
    const again = (await ai().get({ headers: admin.headers })).data!
    expect(again.projectDefaults).toEqual([{ projectId: web.id, templateId: setup.templates[1]!.id }])
  })

  test("someone outside the workspace is told it doesn't exist", async () => {
    const stranger = await createUserWithToken(ctx.db, { workspaceId: null })
    expect((await ai().get({ headers: stranger.headers })).status).toBe(404)
  })
})

describe("templateFor", () => {
  const t = (id: string) => ({ id, name: id, skeleton: "", instructions: "", updatedAt: new Date(0) })
  const setup = (over: Partial<Parameters<typeof templateFor>[0]>) => ({ defaultTemplateId: null, projectDefaults: [], templates: [t("t1"), t("t2"), t("t3")], ...over })

  test("the project's own template, else the workspace default, else the first", () => {
    expect(templateFor(setup({ projectDefaults: [{ projectId: "p", templateId: "t2" }], defaultTemplateId: "t1" }), "p")).toBe("t2")
    expect(templateFor(setup({ projectDefaults: [{ projectId: "p", templateId: null }], defaultTemplateId: "t1" }), "p")).toBe("t1")
    expect(templateFor(setup({ defaultTemplateId: "t3" }), null)).toBe("t3")
    expect(templateFor(setup({ defaultTemplateId: null }), null)).toBe("t1")
    expect(templateFor(setup({ templates: [] }), "p")).toBeNull()
  })
})
