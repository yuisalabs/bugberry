import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { eq } from "drizzle-orm"
import { comment, notification, report } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, directClient, mcpClient, testMcpContext } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let client: Client
let reportId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana" })
  budi = await createUserWithToken(ctx.db, { name: "Budi" })
  client = await mcpClient(ctx.app, ana.headers)
  reportId = (await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Pay fails", visibility: "public" })).id
})

const commentsOf = () => ctx.db.select().from(comment).where(eq(comment.reportId, reportId))

describe("comments", () => {
  test("addComment stores viaAgent 'AI agent' for a personal token and notifies mentions", async () => {
    const result = await callTool(client, "addComment", { report: reportId, body: `@[user:${budi.user.id}] root cause is the stock check` })
    expect(result.isError).toBe(false)
    expect(result.text).toContain("Comment added")
    const [row] = await commentsOf()
    expect(row?.viaAgent).toBe("AI agent")
    expect(row?.authorId).toBe(ana.user.id)
    const notes = await ctx.db.select().from(notification).where(eq(notification.userId, budi.user.id))
    expect(notes).toHaveLength(1)
  })

  test("editComment and deleteComment follow author/admin rules", async () => {
    const id = newId()
    await ctx.db.insert(comment).values({ id, reportId, authorId: budi.user.id, body: "Budi's" })
    expect(await callTool(client, "editComment", { commentId: id, body: "x" })).toMatchObject({
      isError: true,
      text: "Only the author can edit this comment",
    })
    expect(await callTool(client, "deleteComment", { commentId: id })).toMatchObject({
      isError: true,
      text: "Only the author or an admin can delete this comment",
    })
    const budiClient = await mcpClient(ctx.app, budi.headers)
    expect((await callTool(budiClient, "editComment", { commentId: id, body: "Edited" })).isError).toBe(false)
    expect((await commentsOf())[0]?.body).toBe("Edited")
    expect((await callTool(budiClient, "deleteComment", { commentId: id })).text).toContain("deleted")
    expect(await commentsOf()).toHaveLength(0)
  })
})

describe("updateReport", () => {
  test("changes status, assignee me/none, project by slug", async () => {
    const shop = await createProject(ctx.db, { slug: "shop" })
    const result = await callTool(client, "updateReport", { report: reportId, status: "in_progress", assignee: "me", project: "shop", priority: "high" })
    expect(result.isError).toBe(false)
    let [row] = await ctx.db.select().from(report).where(eq(report.id, reportId))
    expect(row).toMatchObject({ status: "in_progress", assigneeId: ana.user.id, projectId: shop.id, priority: "high" })

    await callTool(client, "updateReport", { report: reportId, assignee: "none", project: "none" })
    ;[row] = await ctx.db.select().from(report).where(eq(report.id, reportId))
    expect(row).toMatchObject({ assigneeId: null, projectId: null })

    await callTool(client, "updateReport", { report: reportId, assignee: budi.user.id })
    ;[row] = await ctx.db.select().from(report).where(eq(report.id, reportId))
    expect(row?.assigneeId).toBe(budi.user.id)
  })

  test("has no visibility input", async () => {
    const before = (await ctx.db.select().from(report).where(eq(report.id, reportId)))[0]?.visibility
    const { tools } = await client.listTools()
    const update = tools.find((tool) => tool.name === "updateReport")
    expect(Object.keys(update?.inputSchema.properties ?? {})).not.toContain("visibility")
    await callTool(client, "updateReport", { report: reportId, visibility: "workspace", title: "Renamed" }).catch(() => null)
    const [row] = await ctx.db.select().from(report).where(eq(report.id, reportId))
    expect(row?.visibility).toBe(before)
  })

  test("refuses an empty update", async () => {
    expect(await callTool(client, "updateReport", { report: reportId })).toMatchObject({ isError: true, text: "Nothing to update" })
  })
})

describe("notifications", () => {
  test("markNotificationsRead marks one or all", async () => {
    const make = async () => {
      const commentId = newId()
      await ctx.db.insert(comment).values({ id: commentId, reportId, authorId: budi.user.id, body: "hi" })
      const id = newId()
      await ctx.db.insert(notification).values({ id, userId: ana.user.id, commentId, reportId, actorId: budi.user.id })
      return id
    }
    const first = await make()
    await make()
    await callTool(client, "markNotificationsRead", { id: first })
    let rows = await ctx.db.select().from(notification).where(eq(notification.userId, ana.user.id))
    expect(rows.filter((row) => row.readAt !== null)).toHaveLength(1)
    await callTool(client, "markNotificationsRead", { all: true })
    rows = await ctx.db.select().from(notification).where(eq(notification.userId, ana.user.id))
    expect(rows.every((row) => row.readAt !== null)).toBe(true)
    expect(await callTool(client, "markNotificationsRead", {})).toMatchObject({ isError: true, text: "Give either id or all: true" })
  })
})

describe("who may write", () => {
  test("share viewers cannot write or read comments", async () => {
    const outsider = await createUserWithToken(ctx.db, { workspaceId: null, email: "eve@kantor.test" })
    const viewer = await mcpClient(ctx.app, outsider.headers)
    for (const [tool, args] of [
      ["addComment", { report: reportId, body: "hi" }],
      ["updateReport", { report: reportId, status: "closed" }],
      ["getComments", { report: reportId }],
    ] as const) {
      expect(await callTool(viewer, tool, args)).toMatchObject({ isError: true, text: "Only members of this report's workspace can do this" })
    }
    expect(await commentsOf()).toHaveLength(0)
    const [row] = await ctx.db.select().from(report).where(eq(report.id, reportId))
    expect(row?.status).toBe("open")
  })

  test("a read-only connection cannot use write tools", async () => {
    const readOnly = await directClient(testMcpContext(ctx, ana.user, { caller: { scopes: new Set(["bugberry:read"]) } }))
    expect(await callTool(readOnly, "addComment", { report: reportId, body: "hi" })).toMatchObject({
      isError: true,
      text: "This connection can only read. Reconnect BugBerry and allow changes to use this tool.",
    })
    expect(await commentsOf()).toHaveLength(0)
    expect((await callTool(readOnly, "getReport", { report: reportId })).isError).toBe(false)
  })
})
