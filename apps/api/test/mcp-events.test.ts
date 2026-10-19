import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient, putDebugger, samplePayload } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let client: Client
let reportId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  const ana = await createUserWithToken(ctx.db)
  client = await mcpClient(ctx.app, ana.headers)
  reportId = crypto.randomUUID()
  await createReadyReport(ctx.db, { id: reportId, reporterId: ana.user.id, debuggerKey: await putDebugger(ctx, reportId, samplePayload()) })
})

const lines = (text: string) => text.split("\n")

describe("getTimeline", () => {
  test("orders events and applies default filters", async () => {
    const { text } = await callTool(client, "getTimeline", { report: reportId })
    expect(text).not.toContain("/api/cart")
    expect(text).toContain("+00:05.2  NETWORK     POST https://shop.test/api/orders → 500")
    expect(text).toContain("+00:06.0  NOTE        Note 1: Clicked pay twice (Ana)")
    expect(text).toContain("+00:10.0  PAUSE       Recording paused for 3.0s")
    const offsets = lines(text)
      .map((line) => line.slice(0, 8))
      .filter((label) => /^[+-]\d\d:/.test(label))
    expect(offsets).toEqual([...offsets].sort())
  })

  test("includeAll shows every request and console level", async () => {
    const { text } = await callTool(client, "getTimeline", { report: reportId, includeAll: true })
    expect(text).toContain("GET https://shop.test/api/cart → 200")
  })

  test("kinds and time window", async () => {
    const { text } = await callTool(client, "getTimeline", { report: reportId, kinds: ["action", "navigation"], fromSec: 6 })
    const entries = lines(text).filter((line) => line.startsWith("+"))
    expect(entries).toHaveLength(2)
    expect(entries[0]).toContain("Rage click")
    expect(entries[1]).toContain("Navigated to https://shop.test/cart")
  })

  test("a huge report still answers one page", async () => {
    const id = crypto.randomUUID()
    const events = Array.from({ length: 50_000 }, (_, n) => ({ kind: "console", t: n * 10, level: "error", args: [`line ${n}`] }))
    const ana = await createUserWithToken(ctx.db)
    await createReadyReport(ctx.db, { id, reporterId: ana.user.id, debuggerKey: await putDebugger(ctx, id, { events }) })
    const { text } = await callTool(await mcpClient(ctx.app, ana.headers), "getTimeline", { report: id })
    expect(lines(text).filter((line) => line.startsWith("+"))).toHaveLength(50)
    expect(text).toContain("4950 more. Call again with cursor=")
  })
})

describe("getConsoleLogs", () => {
  test("filters by level and search and shows source", async () => {
    const errors = await callTool(client, "getConsoleLogs", { report: reportId, levels: ["error"] })
    expect(errors.text).toContain("+00:05.3 [error] Order failed (checkout.js:91)")
    expect(errors.text).toContain("TypeError: x is undefined")
    const searched = await callTool(client, "getConsoleLogs", { report: reportId, search: "typeerror" })
    expect(searched.text).not.toContain("Order failed")
    expect(searched.text).toContain("at pay (https://shop.test/js/checkout.js:120:4)")
  })
})

describe("getUserActions", () => {
  test("describes masked inputs without values", async () => {
    const { text } = await callTool(client, "getUserActions", { report: reportId })
    expect(text).toContain("+00:04.0 Typed into input#email (hidden value)")
    expect(text).not.toContain("•")
    expect(text).toContain('+00:05.0 Clicked button "Pay now"')
    expect(text).toContain("(rage click)")
  })

  test("types filter", async () => {
    const { text } = await callTool(client, "getUserActions", { report: reportId, types: ["navigate"] })
    expect(lines(text).filter((line) => line.startsWith("+"))).toEqual(["+00:20.0 Navigated to https://shop.test/cart via History API"])
  })
})

describe("pagination and missing data", () => {
  test("pagination returns a cursor and the next page", async () => {
    const first = await callTool(client, "getUserActions", { report: reportId, limit: 2 })
    const cursor = first.text.match(/cursor="([^"]+)"/)?.[1]
    expect(cursor).toBeDefined()
    const second = await callTool(client, "getUserActions", { report: reportId, limit: 2, cursor })
    expect(second.text).toContain("Rage click")
  })

  test("no debugger data gives the exact message, not an error", async () => {
    const ana = await createUserWithToken(ctx.db)
    const empty = await createReadyReport(ctx.db, { reporterId: ana.user.id })
    for (const tool of ["getTimeline", "getConsoleLogs", "getUserActions"]) {
      const result = await callTool(await mcpClient(ctx.app, ana.headers), tool, { report: empty.id })
      expect(result).toMatchObject({ isError: false, text: "This report has no captured debugger data" })
    }
  })
})
