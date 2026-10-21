import { beforeEach, describe, expect, test } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { integration, reportActivity } from "../src/db/schema"
import { createDispatcher } from "../src/lib/trackers/dispatch"
import { TrackerError } from "../src/lib/trackers/providers"
import { createProject, createReadyReport, createUserWithToken, type FakeTrackers, fakeTrackers, setupTestApp } from "./helpers"
import { callTool, mcpClient } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let trackers: FakeTrackers
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string
let reportId: string

beforeEach(async () => {
  trackers = fakeTrackers()
  ctx = await setupTestApp({}, { trackers: trackers.factory })
  ana = await createUserWithToken(ctx.db, { name: "Ana", role: "admin" })
  budi = await createUserWithToken(ctx.db, { name: "Budi" })
  projectId = (await createProject(ctx.db)).id
  reportId = (await createReadyReport(ctx.db, { projectId, reporterId: ana.user.id, title: "Pay fails" })).id
})

const lines = () => ctx.db.select().from(reportActivity).where(eq(reportActivity.reportId, reportId)).orderBy(asc(reportActivity.createdAt))
const patch = (body: Record<string, unknown>, who = ana) => ctx.api.api.reports({ id: reportId }).patch(body, { headers: who.headers })

describe("recording report changes", () => {
  test("a status change records from and to; setting the same value records nothing", async () => {
    await patch({ status: "in_progress" })
    await patch({ status: "in_progress" })
    const rows = await lines()
    expect(rows.map((row) => [row.kind, row.detail, row.actorId, row.viaAgent])).toEqual([
      ["status", { from: "open", to: "in_progress" }, ana.user.id, null],
    ])
  })

  test("priority, assignee and title each get their own line", async () => {
    await patch({ priority: "high", assigneeId: budi.user.id, title: "Pay button fails" })
    const rows = await lines()
    expect(rows.map((row) => [row.kind, row.detail]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ["assignee", { from: null, to: budi.user.id }],
      ["priority", { from: "none", to: "high" }],
      ["title", { from: "Pay fails", to: "Pay button fails" }],
    ])
  })

  test("an MCP update names the person and the agent", async () => {
    const client = await mcpClient(ctx.app, budi.headers)
    await callTool(client, "updateReport", { report: reportId, priority: "critical" })
    const [row] = await lines()
    expect(row).toMatchObject({ kind: "priority", actorId: budi.user.id, viaAgent: "AI agent" })
  })

  test("changing visibility, description or project records nothing", async () => {
    const other = (await createProject(ctx.db, { slug: "other" })).id
    await patch({ visibility: "public", description: "More detail", projectId: other })
    expect(await lines()).toEqual([])
  })
})

describe("recording tracker sends", () => {
  const addIntegration = async (autoSend = false) => {
    const { data } = await ctx.api.api.projects({ id: projectId }).integrations.post(
      { provider: "github", config: { owner: "kantor", repo: "web", labels: [] }, secret: "ghp_token" },
      { headers: ana.headers },
    )
    const id = data?.id ?? ""
    if (autoSend) await ctx.db.update(integration).set({ autoSend: true }).where(eq(integration.id, id))
    return id
  }

  test("a send records once, with the sender", async () => {
    const integrationId = await addIntegration()
    const send = () => ctx.api.api.reports({ id: reportId }).trackers({ integrationId }).send.post(undefined, { headers: budi.headers })
    await send()
    await send()
    const rows = await lines()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: "tracker", actorId: budi.user.id, viaAgent: null, detail: { provider: "github" } })
    expect((rows[0]?.detail as { externalId: string }).externalId).toBeTruthy()
    expect((rows[0]?.detail as { automatic?: boolean }).automatic).toBeUndefined()
  })

  test("an MCP send names the person and the agent", async () => {
    const integrationId = await addIntegration()
    const client = await mcpClient(ctx.app, budi.headers)
    await callTool(client, "sendToTracker", { report: reportId, integrationId })
    expect((await lines())[0]).toMatchObject({ kind: "tracker", actorId: budi.user.id, viaAgent: "AI agent" })
  })

  test("an automatic send has no actor", async () => {
    await addIntegration(true)
    const dispatcher = createDispatcher({ config: ctx.config, db: ctx.db, storage: ctx.storage, trackers: trackers.factory })
    await dispatcher.autoSend(reportId)
    expect((await lines())[0]).toMatchObject({ kind: "tracker", actorId: null, viaAgent: null, detail: { automatic: true } })
  })

  test("a failed send records nothing", async () => {
    const integrationId = await addIntegration()
    trackers.behaviour.createIssue = async () => {
      throw new TrackerError("GitHub said no")
    }
    await ctx.api.api.reports({ id: reportId }).trackers({ integrationId }).send.post(undefined, { headers: budi.headers })
    expect(await lines()).toEqual([])
  })
})
