import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { comment, notification } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { addMember, createProject, createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"
import { callTool, mcpClient } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let client: Client

const SUMMARY = { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] }

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana", email: "ana@kantor.test", role: "admin" })
  budi = await createUserWithToken(ctx.db, { name: "Budi", email: "budi@kantor.test" })
  client = await mcpClient(ctx.app, ana.headers)
})

const entries = (text: string) => text.split("\n").filter((line) => line.startsWith("BB-"))

describe("searchReports", () => {
  test("maps filters and paginates", async () => {
    const shop = await createProject(ctx.db, { name: "Shop", slug: "shop" })
    await createReadyReport(ctx.db, { reporterId: ana.user.id, projectId: shop.id, title: "Pay fails", status: "open", debuggerSummary: { ...SUMMARY, errors: 2 } })
    await createReadyReport(ctx.db, { reporterId: ana.user.id, projectId: shop.id, title: "Logo blurry", status: "resolved" })
    await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Login loop", status: "open" })

    expect(entries((await callTool(client, "searchReports", {})).text)).toHaveLength(3)
    const open = entries((await callTool(client, "searchReports", { status: ["open"], project: "shop" })).text)
    expect(open).toHaveLength(1)
    expect(open[0]).toContain("Pay fails · open/none")
    expect(open[0]).toContain("2 errors, 0 failed requests")
    expect(entries((await callTool(client, "searchReports", { project: "none" })).text)).toHaveLength(1)
    expect(entries((await callTool(client, "searchReports", { hasErrors: true })).text)).toHaveLength(1)
    expect(entries((await callTool(client, "searchReports", { query: "login" })).text)).toHaveLength(1)

    const first = await callTool(client, "searchReports", { limit: 2 })
    expect(entries(first.text)).toHaveLength(2)
    const cursor = first.text.match(/cursor="([^"]+)"/)?.[1]
    expect(entries((await callTool(client, "searchReports", { limit: 2, cursor })).text)).toHaveLength(1)
  })

  test("assignee me and none", async () => {
    await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Mine", assigneeId: ana.user.id })
    await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Budi's", assigneeId: budi.user.id })
    await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Nobody's" })
    expect(entries((await callTool(client, "searchReports", { assignee: "me" })).text).map((line) => line.split(" · ")[1])).toEqual(["Mine"])
    expect(entries((await callTool(client, "searchReports", { assignee: "none" })).text).map((line) => line.split(" · ")[1])).toEqual([
      "Nobody's",
    ])
  })

  test("another workspace's id is refused like the dashboard", async () => {
    const other = await createWorkspaceRow(ctx.db, "Other")
    const result = await callTool(client, "searchReports", { workspace: other.id })
    expect(result).toMatchObject({ isError: true, text: "Workspace not found" })
  })
})

describe("workspaces, projects and members", () => {
  test("listWorkspaces marks the current one", async () => {
    const second = await createWorkspaceRow(ctx.db, "Second")
    await addMember(ctx.db, second.id, ana.user.id)
    const { text } = await callTool(client, "listWorkspaces")
    expect(text).toContain(`${ctx.workspace.id} · ${ctx.workspace.slug} · Test · admin (current)`)
    expect(text).toContain(`${second.id} · ${second.slug} · Second · member`)
  })

  test("listProjects shows ids, slugs and URL patterns", async () => {
    const shop = await createProject(ctx.db, { name: "Shop", slug: "shop", urlPatterns: ["shop.test/*"] })
    const { text } = await callTool(client, "listProjects")
    expect(text).toContain(`${shop.id} · shop · Shop · shop.test/*`)
  })

  test("listMembers includes ids usable for mentions", async () => {
    const { text } = await callTool(client, "listMembers")
    expect(text).toContain(`${budi.user.id} · Budi <budi@kantor.test> · member`)
    expect(text).toContain("@[user:<id>]")
  })
})

describe("getNotifications", () => {
  test("shows via-AI mentions", async () => {
    const report = await createReadyReport(ctx.db, { reporterId: budi.user.id, title: "Pay fails" })
    const commentId = newId()
    await ctx.db.insert(comment).values({ id: commentId, reportId: report.id, authorId: budi.user.id, body: "look", viaAgent: "Cursor" })
    await ctx.db.insert(notification).values({ id: newId(), userId: ana.user.id, commentId, reportId: report.id, actorId: budi.user.id })
    const { text } = await callTool(client, "getNotifications")
    expect(text).toContain(`Budi (via Cursor) mentioned you in BB-${report.number} · Pay fails`)
    expect(text).toContain("look")
  })
})

describe("ChatGPT search and fetch", () => {
  test("follow the fixed shapes", async () => {
    const report = await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Pay fails" })
    const search = await callTool(client, "search", { query: "pay" })
    const url = `http://localhost:3000/app/r/${report.id}`
    expect(search.structured).toEqual({ results: [{ id: report.id, title: `BB-${report.number} · Pay fails`, url }] })
    expect(JSON.parse(search.text)).toEqual(search.structured)

    const fetched = await callTool(client, "fetch", { id: report.id })
    const doc = JSON.parse(fetched.text)
    expect(doc).toMatchObject({ id: report.id, title: `BB-${report.number} · Pay fails`, url, metadata: { status: "open", priority: "none" } })
    expect(doc.text).toContain("Pay fails")
  })
})
