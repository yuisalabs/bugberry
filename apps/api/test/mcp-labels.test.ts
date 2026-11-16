import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { desc, eq } from "drizzle-orm"
import { reportActivity } from "../src/db/schema"
import { setReportLabels } from "../src/modules/labels/service"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let client: Client
let reportId: string
let number: number
let bug: { id: string }
let checkout: { id: string }

const createLabel = async (name: string) =>
  (await (
    await ctx.app.handle(
      new Request("http://localhost/api/labels", {
        method: "POST",
        headers: { ...ana.headers, "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    )
  ).json()) as { id: string }

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana" })
  client = await mcpClient(ctx.app, ana.headers)
  const created = await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Pay fails" })
  reportId = created.id
  number = created.number
  bug = await createLabel("Bug")
  checkout = await createLabel("Checkout")
})

const labelNames = async () => {
  const response = await ctx.app.handle(new Request(`http://localhost/api/reports/${reportId}`, { headers: ana.headers }))
  return ((await response.json()) as { labels: Array<{ name: string }> }).labels.map((label) => label.name)
}

describe("labels through MCP", () => {
  test("listLabels names the workspace's labels with their colors and counts", async () => {
    await setReportLabels(ctx, ana.user, reportId, [bug.id])
    const result = await callTool(client, "listLabels", {})
    expect(result.isError).toBe(false)
    expect(result.text).toContain("Bug · gray · 1 report")
    expect(result.text).toContain("Checkout · gray · 0 reports")
  })

  test("searchReports by label name finds the labelled report and shows its labels", async () => {
    await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Unrelated" })
    await setReportLabels(ctx, ana.user, reportId, [bug.id, checkout.id])
    const result = await callTool(client, "searchReports", { labels: ["bug"] })
    expect(result.text).toContain("Pay fails")
    expect(result.text).not.toContain("Unrelated")
    expect(result.text).toContain("[Bug, Checkout]")
  })

  test("getReport names the report's labels", async () => {
    await setReportLabels(ctx, ana.user, reportId, [bug.id])
    expect((await callTool(client, "getReport", { report: `BB-${number}` })).text).toContain("Labels: Bug")
  })

  test("updateReport adds and removes labels by name and records the agent", async () => {
    await setReportLabels(ctx, ana.user, reportId, [checkout.id])
    const result = await callTool(client, "updateReport", { report: reportId, addLabels: ["bug"] })
    expect(result.isError).toBe(false)
    expect(await labelNames()).toEqual(["Bug", "Checkout"])
    const [last] = await ctx.db.select().from(reportActivity).where(eq(reportActivity.reportId, reportId)).orderBy(desc(reportActivity.createdAt)).limit(1)
    expect(last).toMatchObject({ kind: "labels", viaAgent: "AI agent", detail: { added: ["Bug"], removed: [] } })
    await callTool(client, "updateReport", { report: reportId, removeLabels: ["CHECKOUT"] })
    expect(await labelNames()).toEqual(["Bug"])
  })

  test("an unknown label name is refused with the labels that exist", async () => {
    const result = await callTool(client, "updateReport", { report: reportId, addLabels: ["urgent"] })
    expect(result).toMatchObject({ isError: true, text: 'No label named "urgent". Labels here: Bug, Checkout.' })
  })

  test("adding an 11th label is refused", async () => {
    const ids: string[] = []
    for (let i = 1; i <= 10; i++) ids.push((await createLabel(`L${i}`)).id)
    await setReportLabels(ctx, ana.user, reportId, ids)
    const result = await callTool(client, "updateReport", { report: reportId, addLabels: ["Bug"] })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("at most 10 labels")
  })
})
