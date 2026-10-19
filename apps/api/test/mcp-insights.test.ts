import { beforeEach, describe, expect, test } from "bun:test"
import { normalizePayload } from "@bugberry/debugger-view"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { codeHotspots, frustrationSignals } from "../src/mcp/tools/insights"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient, putDebugger, samplePayload, T0 } from "./mcp-helpers"

const view = () => normalizePayload(samplePayload())

describe("frustrationSignals", () => {
  test("finds rage clicks, errors after actions and failures after a click", () => {
    const signals = frustrationSignals(view())
    expect(signals.find((signal) => signal.kind === "rage-click")?.atMs).toBe(7000)
    expect(signals.some((signal) => signal.kind === "error-after-action" && signal.text.includes("Order failed"))).toBe(true)
    expect(signals.some((signal) => signal.kind === "failed-after-submit" && signal.text.includes("/api/orders"))).toBe(true)
    const times = signals.map((signal) => signal.atMs)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  test("going back to a page just left is back-and-forth", () => {
    const payload = samplePayload()
    payload.events.push(
      { kind: "action", t: T0 + 21_000, type: "navigate", url: "https://shop.test/checkout", via: "back-forward" },
      { kind: "action", t: T0 + 22_000, type: "navigate", url: "https://shop.test/cart", via: "back-forward" },
    )
    const signals = frustrationSignals(normalizePayload(payload))
    expect(signals.some((signal) => signal.kind === "back-and-forth")).toBe(true)
  })
})

describe("codeHotspots", () => {
  test("groups errors and failed requests by file:line", () => {
    const hotspots = codeHotspots(view())
    const locations = hotspots.map((spot) => spot.location)
    expect(locations).toEqual(expect.arrayContaining(["checkout.js:88", "checkout.js:91", "checkout.js:120"]))
    expect(hotspots.find((spot) => spot.location === "checkout.js:120")?.scriptUrl).toBe("https://shop.test/js/checkout.js")
    expect(hotspots.find((spot) => spot.location === "checkout.js:88")?.examples[0]).toContain("POST https://shop.test/api/orders → 500")
  })

  test("repeats rank first", () => {
    const payload = samplePayload()
    payload.events.push(
      { kind: "console", t: T0 + 25_000, level: "error", args: ["Order failed again"], source: "checkout.js:91" },
      { kind: "console", t: T0 + 26_000, level: "warn", args: ["Order still failing"], source: "checkout.js:91" },
    )
    const [first] = codeHotspots(normalizePayload(payload))
    expect(first).toMatchObject({ location: "checkout.js:91", count: 3 })
    expect(first?.examples).toHaveLength(3)
  })
})

describe("insight tools", () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>
  let client: Client
  let reportId: string

  beforeEach(async () => {
    ctx = await setupTestApp()
    const ana = await createUserWithToken(ctx.db)
    client = await mcpClient(ctx.app, ana.headers)
    reportId = crypto.randomUUID()
    await createReadyReport(ctx.db, {
      id: reportId,
      reporterId: ana.user.id,
      captureType: "video",
      durationMs: 30_000,
      debuggerKey: await putDebugger(ctx, reportId, samplePayload()),
    })
  })

  test("getPerformance lists app.js as the slowest and largest resource", async () => {
    const { text } = await callTool(client, "getPerformance", { report: reportId })
    expect(text).toContain("https://shop.test/checkout: DOMContentLoaded 800 ms, load 1500 ms")
    expect(text).toMatch(/Slowest files:\n- 3000 ms https:\/\/shop\.test\/js\/app\.js/)
    expect(text).toMatch(/Largest transfers:\n- 900.0 kB https:\/\/shop\.test\/js\/app\.js/)
    expect(text).toContain("waiting 900 ms")
    expect(text).toContain("Connection: 4G, 10 Mbps, 50 ms latency")
  })

  test("getFrustrationSignals starts with the BugBerry flagged list", async () => {
    const { text } = await callTool(client, "getFrustrationSignals", { report: reportId })
    expect(text.startsWith("BugBerry flagged:")).toBe(true)
    expect(text).toContain("rage-click")
  })

  test("getCodeHotspots names files and suggests searching the code", async () => {
    const { text } = await callTool(client, "getCodeHotspots", { report: reportId })
    expect(text).toContain("checkout.js:120")
    expect(text).toContain("https://shop.test/js/checkout.js")
  })

  test("each tool answers the no-debugger message", async () => {
    const ana = await createUserWithToken(ctx.db)
    const empty = await createReadyReport(ctx.db, { reporterId: ana.user.id })
    const other = await mcpClient(ctx.app, ana.headers)
    for (const tool of ["getPerformance", "getFrustrationSignals", "getCodeHotspots"]) {
      expect(await callTool(other, tool, { report: empty.id })).toMatchObject({ text: "This report has no captured debugger data" })
    }
  })
})
