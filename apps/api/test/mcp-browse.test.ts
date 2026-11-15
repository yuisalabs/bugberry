import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { comment, notification } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { addMember, createProject, createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"
import { callTool, directClient, mcpClient, testMcpContext } from "./mcp-helpers"
import { resolveReport } from "../src/modules/reports/fixes"

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
    expect(first.text.split("\n")[0]).toBe("3 reports found.")
    expect(first.text).toContain("More available. Call again with cursor=")
    const cursor = first.text.match(/cursor="([^"]+)"/)?.[1]
    const second = await callTool(client, "searchReports", { limit: 2, cursor })
    expect(entries(second.text)).toHaveLength(1)
    expect(second.text).not.toContain("found")
    expect(second.text).not.toContain("cursor=")
  })

  test("the first page says how many reports the filters hold, whatever the page size", async () => {
    for (const status of ["open", "open", "resolved"] as const) await createReadyReport(ctx.db, { reporterId: ana.user.id, status })
    expect((await callTool(client, "searchReports", { status: ["open"], limit: 1 })).text.split("\n")[0]).toBe("2 reports found.")
    expect((await callTool(client, "searchReports", { status: ["resolved"] })).text.split("\n")[0]).toBe("1 report found.")
    expect((await callTool(client, "searchReports", { status: ["closed"] })).text).toBe("No reports match.")
  })

  test("when the count fails the reports are still sent, without the number", async () => {
    for (const title of ["Pay fails", "Login loop"]) await createReadyReport(ctx.db, { reporterId: ana.user.id, title })
    // A database whose status count fails, as one cut off by MCP's statement timeout does; every other query works.
    const db = new Proxy(ctx.db, {
      get(target, key) {
        if (key !== "select") return Reflect.get(target, key, target)
        return (fields?: Record<string, unknown>) => {
          if (fields && "count" in fields && "status" in fields) throw new Error("canceling statement due to statement timeout")
          return fields ? target.select(fields as never) : target.select()
        }
      },
    })
    const logged = spyOn(console, "error").mockImplementation(() => {})
    try {
      const direct = await directClient(testMcpContext(ctx, ana.user, { deps: { ...ctx, db } }))
      const result = await callTool(direct, "searchReports", { limit: 1 })
      expect(result.isError).toBe(false)
      expect(entries(result.text)).toHaveLength(1)
      expect(result.text).not.toContain("found")
      expect(result.text).toContain("More available. Call again with cursor=")
      expect(result.structured).not.toHaveProperty("total")
      expect(logged).toHaveBeenCalledTimes(1)
    } finally {
      logged.mockRestore()
    }
  })

  test("a cursor of the old kind, or for another sort, is refused", async () => {
    for (let n = 0; n < 3; n++) await createReadyReport(ctx.db, { reporterId: ana.user.id })
    expect((await callTool(client, "searchReports", { cursor: Buffer.from("page:2").toString("base64url") })).text).toBe("Invalid cursor")
    const cursor = (await callTool(client, "searchReports", { limit: 1 })).text.match(/cursor="([^"]+)"/)?.[1]
    expect((await callTool(client, "searchReports", { limit: 1, cursor, sort: "oldest" })).text).toBe("Invalid cursor")
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

describe("getNotifications for a resolved report", () => {
  test("says who resolved it and where it was fixed", async () => {
    const report = await createReadyReport(ctx.db, { reporterId: ana.user.id, title: "Pay fails" })
    await resolveReport(ctx, budi.user, report.id, { links: ["https://github.com/shop/web/pull/42"] }, { viaAgent: "Claude Code" })
    const { text } = await callTool(client, "getNotifications")
    expect(text).toContain(`Budi (via Claude Code) resolved BB-${report.number} · Pay fails`)
    expect(text).toContain("Fixed in PR #42 · shop/web")
    expect(text.split("\n").at(-1)?.trim()).toBe(`http://localhost:3000/app/r/${report.id}`)
    expect(text).not.toContain("#comment-null")
  })
})
