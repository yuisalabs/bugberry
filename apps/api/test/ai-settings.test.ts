import { beforeEach, describe, expect, test } from "bun:test"
import { workspaceAiProvider } from "../src/db/schema"
import { PRIVATE_HOST_MESSAGE } from "../src/lib/net/host-guard"
import { fakeAi } from "./ai-helpers"
import { addMember, createProject, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ai: ReturnType<typeof fakeAi>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let member: Awaited<ReturnType<typeof createUserWithToken>>

async function start(overrides: Parameters<typeof setupTestApp>[0] = {}) {
  ai = fakeAi()
  ctx = await setupTestApp(overrides, { aiFetch: ai.fetcher })
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  member = await createUserWithToken(ctx.db)
}
beforeEach(() => start())

const base = () => ctx.api.api.workspaces({ id: ctx.workspace.id }).ai
const setup = async () => (await base().get({ headers: admin.headers })).data!
const OPENAI = { preset: "openai" as const, model: "gpt-4.1-mini", apiKey: "sk-live-1234a1b2" }

describe("the team key", () => {
  test("saving tests the key first; a rejected key is not saved and says so", async () => {
    ai.replies.push({ status: 401, body: {} })
    const res = await base().provider.put({ ...OPENAI, apiKey: "sk-bad" }, { headers: admin.headers })
    expect(res.status).toBe(422)
    expect(res.error?.value).toMatchObject({ code: "ai_key_rejected", message: "The AI key was rejected. Update it in Settings → AI (ask your admin)." })
    expect((await setup()).team.configured).toBe(false)
  })

  test("a saved key is sealed in the database and never returned", async () => {
    const res = await base().provider.put(OPENAI, { headers: admin.headers })
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ configured: true, preset: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", keyHint: "sk-…a1b2" })
    expect(ai.last()?.url).toBe("https://api.openai.com/v1/chat/completions")
    expect(ai.last()?.headers.get("authorization")).toBe("Bearer sk-live-1234a1b2")
    const [row] = await ctx.db.select().from(workspaceAiProvider)
    expect(row?.keyEncrypted.startsWith("v1.")).toBe(true)
    expect(row?.keyEncrypted).not.toContain("1234a1b2")
    expect(JSON.stringify((await base().get({ headers: admin.headers })).data)).not.toContain("sk-live")
  })

  test("changing the model keeps the stored key when apiKey is left out", async () => {
    await base().provider.put(OPENAI, { headers: admin.headers })
    const res = await base().provider.put({ preset: "openai", model: "gpt-4.1" }, { headers: admin.headers })
    expect(res.data).toMatchObject({ model: "gpt-4.1", keyHint: "sk-…a1b2" })
    expect(ai.last()?.headers.get("authorization")).toBe("Bearer sk-live-1234a1b2")
  })

  test("a first save without a key is refused", async () => {
    const res = await base().provider.put({ preset: "openai", model: "gpt-4.1" }, { headers: admin.headers })
    expect(res.status).toBe(422)
    expect(res.error?.value).toMatchObject({ code: "ai_key_required" })
  })

  test("a custom provider needs its base URL, and a pasted endpoint is tidied", async () => {
    expect((await base().provider.put({ preset: "custom", model: "q", apiKey: "k" }, { headers: admin.headers })).status).toBe(422)
    const res = await base().provider.put(
      { preset: "custom", baseUrl: "https://quinella.test/v1/chat/completions", model: "q", apiKey: "k-12345678" },
      { headers: admin.headers },
    )
    expect(res.data).toMatchObject({ baseUrl: "https://quinella.test/v1" })
    expect(ai.last()?.url).toBe("https://quinella.test/v1/chat/completions")
  })

  test("a custom provider on a private address is refused unless the server allows it", async () => {
    await start({ allowPrivateIntegrationHosts: false })
    const res = await base().provider.put({ preset: "custom", baseUrl: "http://10.0.0.5/v1", model: "q", apiKey: "k" }, { headers: admin.headers })
    expect(res.status).toBe(422)
    expect(res.error?.value).toMatchObject({ code: "ai_host_refused", message: PRIVATE_HOST_MESSAGE })
    expect(ai.requests).toHaveLength(0)
  })

  test("removing the key", async () => {
    await base().provider.put(OPENAI, { headers: admin.headers })
    expect((await base().provider.delete({}, { headers: admin.headers })).data).toEqual({ configured: false })
    expect((await setup()).team).toEqual({ configured: false })
  })

  test("members can't set or remove the key", async () => {
    expect((await base().provider.put(OPENAI, { headers: member.headers })).status).toBe(403)
    expect((await base().provider.delete({}, { headers: member.headers })).status).toBe(403)
  })
})

describe("settings", () => {
  test("sendResponseBodies is off until an admin turns it on; members can't", async () => {
    expect((await setup()).sendResponseBodies).toBe(false)
    expect((await base().settings.patch({ sendResponseBodies: true }, { headers: member.headers })).status).toBe(403)
    const res = await base().settings.patch({ sendResponseBodies: true }, { headers: admin.headers })
    expect(res.data?.sendResponseBodies).toBe(true)
  })

  test("admins choose the workspace default and each project's default", async () => {
    const { templates } = await setup()
    const web = await createProject(ctx.db, { name: "Web" })
    const res = await base().settings.patch(
      { defaultTemplateId: templates[1]!.id, projectDefaults: [{ projectId: web.id, templateId: templates[0]!.id }] },
      { headers: admin.headers },
    )
    expect(res.data?.defaultTemplateId).toBe(templates[1]!.id)
    expect(res.data?.projectDefaults).toEqual([{ projectId: web.id, templateId: templates[0]!.id }])
    const cleared = await base().settings.patch({ projectDefaults: [{ projectId: web.id, templateId: null }] }, { headers: admin.headers })
    expect(cleared.data?.projectDefaults).toEqual([])
  })

  test("defaults only accept this workspace's projects and templates", async () => {
    await setup()
    const other = await createWorkspaceRow(ctx.db, "Other")
    await addMember(ctx.db, other.id, admin.user.id, "admin")
    const elsewhere = await createProject(ctx.db, { workspaceId: other.id })
    const foreignTemplate = (await ctx.api.api.workspaces({ id: other.id }).ai.get({ headers: admin.headers })).data!.templates[0]!
    const bad = await base().settings.patch({ defaultTemplateId: foreignTemplate.id }, { headers: admin.headers })
    expect(bad.error?.value).toMatchObject({ code: "template_not_found" })
    const badProject = await base().settings.patch({ projectDefaults: [{ projectId: elsewhere.id, templateId: null }] }, { headers: admin.headers })
    expect(badProject.error?.value).toMatchObject({ code: "project_not_found" })
  })
})

describe("templates", () => {
  test("any member creates, edits and deletes templates; deleting the default clears it", async () => {
    const created = await base().templates.post(
      { name: "QA Indonesia", skeleton: "## Langkah\n## Hasil", instructions: "Tulis dalam Bahasa Indonesia" },
      { headers: member.headers },
    )
    expect(created.status).toBe(200)
    expect(created.data).toMatchObject({ name: "QA Indonesia", skeleton: "## Langkah\n## Hasil", instructions: "Tulis dalam Bahasa Indonesia" })
    const id = created.data!.id
    const edited = await base().templates({ templateId: id }).patch({ name: "QA" }, { headers: member.headers })
    expect(edited.data).toMatchObject({ name: "QA", skeleton: "## Langkah\n## Hasil" })
    await base().settings.patch({ defaultTemplateId: id }, { headers: admin.headers })
    expect((await base().templates({ templateId: id }).delete({}, { headers: member.headers })).status).toBe(200)
    const after = await setup()
    expect(after.defaultTemplateId).toBeNull()
    expect(after.templates.map((template) => template.name)).toEqual(["Steps to reproduce", "Short"])
  })

  test("a template needs a name, and another workspace's template can't be touched", async () => {
    expect((await base().templates.post({ name: "", skeleton: "", instructions: "" }, { headers: member.headers })).status).toBe(422)
    const res = await base().templates({ templateId: "nope" }).patch({ name: "x" }, { headers: member.headers })
    expect(res.error?.value).toMatchObject({ code: "template_not_found" })
  })
})
