import { beforeEach, describe, expect, test } from "bun:test"
import type { Material } from "@bugberry/ai-write"
import { fakeAi, okChoice } from "./ai-helpers"
import { addMember, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ai: ReturnType<typeof fakeAi>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let templates: Array<{ id: string; name: string }>

const base = () => ctx.api.api.workspaces({ id: ctx.workspace.id }).ai

const material = (body?: string): Material => ({
  page: { url: "https://shop.test/checkout", title: "Checkout" },
  device: { browser: "Chrome 141", os: "macOS" },
  omitted: 0,
  lines: [
    { atMs: 1000, kind: "action", text: 'Clicked button "Pay"' },
    { atMs: 1500, kind: "request", text: "POST /api/pay → 500", ...(body ? { body } : {}) },
  ],
})

async function saveTeamKey() {
  await base().provider.put({ preset: "openai", model: "gpt-4.1-mini", apiKey: "sk-live-1234a1b2" }, { headers: admin.headers })
}

beforeEach(async () => {
  ai = fakeAi()
  ctx = await setupTestApp({}, { aiFetch: ai.fetcher })
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  member = await createUserWithToken(ctx.db)
  templates = (await base().get({ headers: admin.headers })).data!.templates
})

const hint = { title: "", description: "debit card" }

describe("POST /workspaces/:id/ai/write", () => {
  test("writes from the material with the chosen template and returns the draft", async () => {
    await saveTeamKey()
    ai.replies.push({ status: 200, body: okChoice('{"title":"Checkout: Pay spins","description":"## Steps to reproduce\\n1. Click Pay"}') })
    const res = await base().write.post({ templateId: templates[0]!.id, material: material(), hint }, { headers: member.headers })
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ title: "Checkout: Pay spins", description: "## Steps to reproduce\n1. Click Pay" })
    const sent = await ai.last()!.json()
    expect(sent.model).toBe("gpt-4.1-mini")
    expect(ai.last()!.headers.get("authorization")).toBe("Bearer sk-live-1234a1b2")
    expect(sent.messages[1].content).toContain("## Steps to reproduce")
    expect(sent.messages[1].content).toContain("debit card")
    expect(sent.messages[1].content).toContain('Clicked button "Pay"')
  })

  test("with the switch off the server drops response bodies the extension sent", async () => {
    await saveTeamKey()
    await base().write.post({ templateId: templates[0]!.id, material: material("SECRET-BODY"), hint }, { headers: member.headers })
    expect(JSON.stringify(await ai.last()!.json())).not.toContain("SECRET-BODY")
  })

  test("with the switch on, bodies reach the provider", async () => {
    await saveTeamKey()
    await base().settings.patch({ sendResponseBodies: true }, { headers: admin.headers })
    await base().write.post({ templateId: templates[0]!.id, material: material("Card declined"), hint }, { headers: member.headers })
    expect(JSON.stringify(await ai.last()!.json())).toContain("Card declined")
  })

  test("query strings in what the extension sent never reach the provider", async () => {
    await saveTeamKey()
    const leaky = { ...material(), page: { url: "https://shop.test/checkout?email=budi@contoh.com", title: null } }
    await base().write.post({ templateId: templates[0]!.id, material: leaky, hint }, { headers: member.headers })
    expect(JSON.stringify(await ai.last()!.json())).not.toContain("budi@contoh.com")
  })

  test("no team key answers 409 ai_not_configured", async () => {
    const res = await base().write.post({ templateId: templates[0]!.id, material: material(), hint }, { headers: member.headers })
    expect(res.status).toBe(409)
    expect(res.error?.value).toMatchObject({ code: "ai_not_configured", message: "AI writing isn't set up for this workspace." })
  })

  test("a template from another workspace answers 404 template_not_found", async () => {
    await saveTeamKey()
    const other = await createWorkspaceRow(ctx.db, "Other")
    await addMember(ctx.db, other.id, member.user.id)
    const foreign = (await ctx.api.api.workspaces({ id: other.id }).ai.get({ headers: member.headers })).data!.templates[0]!
    const res = await base().write.post({ templateId: foreign.id, material: material(), hint }, { headers: member.headers })
    expect(res.status).toBe(404)
    expect(res.error?.value).toMatchObject({ code: "template_not_found" })
  })

  test("a provider quota error answers 502 with the plain text", async () => {
    await saveTeamKey()
    ai.replies.push({ status: 429, body: { error: { code: "insufficient_quota" } } })
    const res = await base().write.post({ templateId: templates[0]!.id, material: material(), hint }, { headers: member.headers })
    expect(res.status).toBe(502)
    expect(res.error?.value).toMatchObject({ code: "ai_quota", message: "Your AI provider says the quota is used up." })
  })

  test("an answer that isn't JSON answers 502 ai_unusable_answer", async () => {
    await saveTeamKey()
    ai.replies.push({ status: 200, body: okChoice("Sorry, I can't.") })
    const res = await base().write.post({ templateId: templates[0]!.id, material: material(), hint }, { headers: member.headers })
    expect(res.error?.value).toMatchObject({ code: "ai_unusable_answer" })
  })

  test("someone outside the workspace can't write with its key", async () => {
    await saveTeamKey()
    const stranger = await createUserWithToken(ctx.db, { workspaceId: null })
    expect((await base().write.post({ templateId: templates[0]!.id, material: material(), hint }, { headers: stranger.headers })).status).toBe(404)
  })

  test("the 21st request in a minute is refused", async () => {
    await saveTeamKey()
    const body = { templateId: templates[0]!.id, material: material(), hint }
    for (let i = 0; i < 20; i++) expect((await base().write.post(body, { headers: member.headers })).status).toBe(200)
    const refused = await base().write.post(body, { headers: member.headers })
    expect(refused.status).toBe(429)
    expect(refused.error?.value).toMatchObject({ code: "rate_limited" })
  })
})
