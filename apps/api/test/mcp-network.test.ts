import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient, putDebugger, samplePayload, T0 } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let client: Client
let reportId: string

const payload = () => {
  const base = samplePayload()
  base.events.push(
    { kind: "network", t: T0 + 8000, method: "GET", url: "https://cdn.test/img/logo.png", status: 404, durationMs: 10, responseBody: "nope" },
    { kind: "network", t: T0 + 9000, method: "POST", url: "https://shop.test/api/track", pending: true },
    {
      kind: "network",
      t: T0 + 9500,
      method: "PUT",
      url: "https://shop.test/api/big",
      status: 500,
      durationMs: 1500,
      responseBody: "y".repeat(30_000),
    },
  )
  return base
}

beforeEach(async () => {
  ctx = await setupTestApp()
  const ana = await createUserWithToken(ctx.db)
  client = await mcpClient(ctx.app, ana.headers)
  reportId = crypto.randomUUID()
  await createReadyReport(ctx.db, { id: reportId, reporterId: ana.user.id, debuggerKey: await putDebugger(ctx, reportId, payload()) })
})

const rows = (text: string) => text.split("\n").filter((line) => line.startsWith("#"))

describe("getNetworkRequests", () => {
  test("defaults include bodies only for failed requests", async () => {
    const { text } = await callTool(client, "getNetworkRequests", { report: reportId })
    expect(rows(text)).toHaveLength(5)
    expect(text).toContain('Response body: {"error":"stock"}')
    expect(text).not.toContain("Response body: null")
    // Bodies arrive capped at MAX_TEXT by normalizePayload; the list cuts them again to 2,000.
    expect(text).toContain("…[truncated 18001 chars]")
  })

  test("status, method, host and urlContains filters", async () => {
    expect(rows((await callTool(client, "getNetworkRequests", { report: reportId, status: ["4xx"] })).text)).toHaveLength(1)
    expect(rows((await callTool(client, "getNetworkRequests", { report: reportId, method: "post" })).text)).toHaveLength(2)
    expect(rows((await callTool(client, "getNetworkRequests", { report: reportId, host: "cdn.test" })).text)).toHaveLength(1)
    expect(rows((await callTool(client, "getNetworkRequests", { report: reportId, urlContains: "orders" })).text)).toHaveLength(1)
    expect(rows((await callTool(client, "getNetworkRequests", { report: reportId, minDurationMs: 1000 })).text)).toHaveLength(1)
  })

  test("index numbers stay the same under filters", async () => {
    const all = rows((await callTool(client, "getNetworkRequests", { report: reportId })).text)
    const failed = rows((await callTool(client, "getNetworkRequests", { report: reportId, failedOnly: true })).text)
    const orders = (list: string[]) => list.find((line) => line.includes("/api/orders"))?.split(" ")[0]
    expect(orders(failed)).toBe(orders(all))
    expect(failed).toHaveLength(3)
  })

  test("pending requests are marked pending", async () => {
    const { text } = await callTool(client, "getNetworkRequests", { report: reportId, urlContains: "track" })
    expect(text).toContain("→ pending")
  })

  test("includeBodies none and all", async () => {
    const none = await callTool(client, "getNetworkRequests", { report: reportId, includeBodies: "none" })
    expect(none.text).not.toContain("Response body")
    const all = await callTool(client, "getNetworkRequests", { report: reportId, includeBodies: "all", status: ["4xx"] })
    expect(all.text).toContain("Response body: nope")
  })
})

describe("getNetworkRequest", () => {
  test("returns full bodies up to MAX_TEXT and refuses an unknown index", async () => {
    const list = rows((await callTool(client, "getNetworkRequests", { report: reportId, urlContains: "big" })).text)
    const index = Number(list[0]?.slice(1).split(" ")[0])
    const { text } = await callTool(client, "getNetworkRequest", { report: reportId, index })
    expect(text).toContain("PUT https://shop.test/api/big")
    expect(text).toContain("y".repeat(20_000))
    expect(text).toContain("curl")

    const missing = await callTool(client, "getNetworkRequest", { report: reportId, index: 99 })
    expect(missing).toMatchObject({ isError: true, text: "No request #99 in this report" })
  })

  test("shows headers and the initiator", async () => {
    const { text } = await callTool(client, "getNetworkRequest", { report: reportId, index: 2 })
    expect(text).toContain("content-type: application/json")
    expect(text).toContain("Initiator: checkout.js:88")
  })
})
