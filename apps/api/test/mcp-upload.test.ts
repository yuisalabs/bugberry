import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import { READ_ONLY_MESSAGE } from "../src/mcp/context"
import { createProject, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, directClient, mcpClient, testMcpContext } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let client: Client

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana" })
  client = await mcpClient(ctx.app, ana.headers)
})

/** What the recorder's stopRecording hands the agent. */
const recording = (overrides: Record<string, unknown> = {}) => ({
  mediaSize: 1200,
  debuggerSize: 300,
  thumbnailSize: 50,
  durationMs: 6000,
  pageUrl: "https://shop.kantor.test/checkout",
  pageTitle: "Checkout",
  device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
  debuggerSummary: { logs: 2, errors: 1, requests: 4, failedRequests: 1, actions: 3, incomplete: [] },
  ...overrides,
})

const create = (args: Record<string, unknown> = {}) =>
  callTool(client, "createUpload", { title: "Pay fails", description: "Clicking Pay shows nothing.", recording: recording(), ...args })

async function rowOf(id: string) {
  const [row] = await ctx.db.select().from(report).where(eq(report.id, id))
  if (!row) throw new Error("report not found")
  return row
}

describe("createUpload", () => {
  test("read-only connection is refused", async () => {
    const readOnly = await directClient(testMcpContext(ctx, ana.user, { caller: { scopes: new Set(["bugberry:read"]) } }))
    const result = await callTool(readOnly, "createUpload", { title: "x", description: "", recording: recording() })
    expect(result.isError).toBe(true)
    expect(result.text).toContain(READ_ONLY_MESSAGE)
  })

  test("creates an uploading report with viaAgent and returns an upload link", async () => {
    const result = await create()
    expect(result.isError).toBe(false)
    const structured = result.structured as { number: number; reportUrl: string; uploadLink: string; expiresAt: string; reportId: string }
    expect(structured.uploadLink.startsWith(`${ctx.config.appUrl}/api/agent-uploads/`)).toBe(true)
    expect(result.text).toContain(`BB-${structured.number}`)
    expect(result.text).toContain("submitRecording")
    expect(result.text).toContain(structured.uploadLink)
    const row = await rowOf(structured.reportId)
    expect(row).toMatchObject({ uploadStatus: "uploading", viaAgent: "AI agent", captureType: "video", title: "Pay fails", durationMs: 6000 })
  })

  test("priority is stored on the report", async () => {
    const result = await create({ priority: "high" })
    expect((await rowOf((result.structured as { reportId: string }).reportId)).priority).toBe("high")
  })

  test("priority left out is none", async () => {
    const result = await create()
    expect((await rowOf((result.structured as { reportId: string }).reportId)).priority).toBe("none")
  })

  test("unknown priority is refused, and no report is made", async () => {
    const before = (await ctx.db.select({ id: report.id }).from(report)).length
    for (const priority of ["urgent", "High"]) {
      const result = await create({ priority })
      expect(result.isError).toBe(true)
    }
    expect((await ctx.db.select({ id: report.id }).from(report)).length).toBe(before)
  })

  test("project comes from URL patterns when not given", async () => {
    const shop = await createProject(ctx.db, { name: "Shop", urlPatterns: ["shop.kantor.test/*"] })
    await createProject(ctx.db, { name: "Admin", urlPatterns: ["admin.kantor.test/*"] })
    const result = await create()
    expect((await rowOf((result.structured as { reportId: string }).reportId)).projectId).toBe(shop.id)
  })

  test("a named project wins, by slug", async () => {
    const admin = await createProject(ctx.db, { name: "Admin", slug: "admin", urlPatterns: ["admin.kantor.test/*"] })
    const result = await create({ project: "admin" })
    expect((await rowOf((result.structured as { reportId: string }).reportId)).projectId).toBe(admin.id)
  })

  test("unknown project is refused", async () => {
    const result = await create({ project: "nope" })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("Project not found")
  })

  test("oversized recording is refused with the server's limit message", async () => {
    const result = await create({ recording: recording({ mediaSize: ctx.config.maxUploadBytes + 1 }) })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("Files must be at most")
  })
})
