import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { eq } from "drizzle-orm"
import { comment, reportActivity } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient, putDebugger, samplePayload } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let client: Client
let reportId: string
let shareSlug: string

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana" })
  budi = await createUserWithToken(ctx.db, { name: "Budi" })
  client = await mcpClient(ctx.app, ana.headers)
  reportId = newId()
  const created = await createReadyReport(ctx.db, {
    id: reportId,
    reporterId: ana.user.id,
    title: "Pay fails",
    visibility: "public",
    debuggerKey: await putDebugger(ctx, reportId, samplePayload()),
  })
  shareSlug = created.shareSlug
})

const reads = () => ctx.db.select().from(reportActivity).where(eq(reportActivity.reportId, reportId))

describe("agent reads", () => {
  test("reading tools note an agent read for members, merged into one line", async () => {
    await callTool(client, "getReport", { report: reportId })
    await callTool(client, "getNetworkRequests", { report: reportId })
    await callTool(client, "getConsoleLogs", { report: reportId })
    const rows = await reads()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: "agent_read",
      actorId: ana.user.id,
      viaAgent: "AI agent",
      detail: { parts: ["report", "network", "console"] },
    })
  })

  test("a share-link viewer's read is not noted", async () => {
    const outsider = await createUserWithToken(ctx.db, { workspaceId: null, email: "eve@kantor.test" })
    const viewer = await mcpClient(ctx.app, outsider.headers)
    const { isError } = await callTool(viewer, "getReport", { report: `http://localhost:3000/s/${shareSlug}` })
    expect(isError).toBe(false)
    expect(await reads()).toEqual([])
  })
})

describe("comment threads over MCP", () => {
  test("addComment with replyTo files the reply under the root", async () => {
    const root = newId()
    await ctx.db.insert(comment).values({ id: root, reportId, authorId: budi.user.id, body: "Root" })
    const reply = newId()
    await ctx.db.insert(comment).values({ id: reply, reportId, authorId: budi.user.id, body: "Reply", parentId: root })
    const result = await callTool(client, "addComment", { report: reportId, body: "Agreed", replyTo: reply })
    expect(result.isError).toBe(false)
    const [row] = await ctx.db.select().from(comment).where(eq(comment.body, "Agreed"))
    expect(row?.parentId).toBe(root)
  })

  test("getComments shows threads, reactions and placeholders without the deleted body", async () => {
    const root = (await ctx.api.api.reports({ id: reportId }).comments.post({ body: "Secret root" }, { headers: budi.headers })).data?.id ?? ""
    await ctx.api.api.reports({ id: reportId }).comments.post({ body: "First answer", replyTo: root }, { headers: ana.headers })
    const second = (await ctx.api.api.reports({ id: reportId }).comments.post({ body: "Later thread" }, { headers: ana.headers })).data?.id ?? ""
    await ctx.api.api.comments({ id: second }).reactions.post({ emoji: "👍" }, { headers: budi.headers })
    await ctx.api.api.comments({ id: root }).delete(undefined, { headers: budi.headers })
    const { text } = await callTool(client, "getComments", { report: reportId })
    expect(text).not.toContain("Secret root")
    expect(text).toContain(`[${root}] (deleted comment)`)
    expect(text).toContain("  ↳ [")
    expect(text).toContain("First answer")
    expect(text).toContain("👍 1")
    expect(text.indexOf("Later thread")).toBeLessThan(text.indexOf("(deleted comment)"))
  })
})
