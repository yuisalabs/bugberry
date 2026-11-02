import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { eq } from "drizzle-orm"
import { comment, project, workspace } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { nextSteps } from "../src/mcp/tools/report-read"
import type { LocalStorageDriver } from "../src/storage/local"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient, putDebugger, samplePayload, T0 } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let client: Client

const SUMMARY = { logs: 1, errors: 2, requests: 2, failedRequests: 1, actions: 4, incomplete: ["websocket"] }

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana", email: "ana@kantor.test" })
  client = await mcpClient(ctx.app, ana.headers)
})

async function sampleReport(overrides: Partial<Parameters<typeof createReadyReport>[1]> = {}) {
  const id = crypto.randomUUID()
  const project = await createProject(ctx.db, { name: "Shop" })
  return createReadyReport(ctx.db, {
    id,
    projectId: project.id,
    reporterId: ana.user.id,
    title: "Pay fails",
    captureType: "video",
    mediaKey: `reports/${id}/media.webm`,
    mediaType: "video/webm",
    durationMs: 30_000,
    debuggerKey: await putDebugger(ctx, id, samplePayload()),
    debuggerSummary: SUMMARY,
    location: "Jakarta, Indonesia",
    ...overrides,
  })
}

describe("getReport", () => {
  test("for a member shows email, location, notes, top errors and next steps", async () => {
    const report = await sampleReport()
    const { text, structured, isError } = await callTool(client, "getReport", { report: `BB-${report.number}` })
    expect(isError).toBe(false)
    for (const part of [
      `BB-${report.number} · Pay fails`,
      "ana@kantor.test",
      "Jakarta, Indonesia",
      "Shop",
      "Chrome 141.0.1",
      "Order failed",
      "+00:06.0 Clicked pay twice (Ana)",
      "getNetworkRequests failedOnly=true",
      "getCodeHotspots",
      "websocket",
      `http://localhost:3000/app/r/${report.id}`,
    ]) {
      expect(text).toContain(part)
    }
    expect(structured).toMatchObject({ id: report.id, number: report.number, access: "member", reporterEmail: "ana@kantor.test" })
  })

  test("for a share viewer hides email, location, comments and trackers", async () => {
    const report = await sampleReport({ visibility: "public" })
    await ctx.db.insert(comment).values({ id: newId(), reportId: report.id, authorId: ana.user.id, body: "secret note" })
    const outsider = await createUserWithToken(ctx.db, { workspaceId: null, email: "eve@kantor.test" })
    const viewer = await mcpClient(ctx.app, outsider.headers)
    const { text, structured } = await callTool(viewer, "getReport", { report: `http://localhost:3000/s/${report.shareSlug}` })
    expect(text).toContain("Pay fails")
    expect(text).not.toContain("ana@kantor.test")
    expect(text).not.toContain("Jakarta, Indonesia")
    expect(text).not.toContain("Comments:")
    expect(text).toContain("read-only")
    expect(structured).toMatchObject({ access: "viewer" })
  })

  test("a member gets the project slug and the workspace", async () => {
    const report = await sampleReport()
    const [own] = await ctx.db.select({ slug: project.slug }).from(project).where(eq(project.id, report.projectId ?? ""))
    const [space] = await ctx.db.select({ slug: workspace.slug }).from(workspace).where(eq(workspace.id, report.workspaceId))
    const { text, structured } = await callTool(client, "getReport", { report: `BB-${report.number}` })
    expect(structured).toMatchObject({ projectSlug: own?.slug, workspace: space?.slug })
    expect(text).toContain(`Project slug: ${own?.slug}`)
  })

  test("a share viewer gets no project slug or workspace", async () => {
    const report = await sampleReport({ visibility: "public" })
    const outsider = await createUserWithToken(ctx.db, { workspaceId: null, email: "eve@kantor.test" })
    const viewer = await mcpClient(ctx.app, outsider.headers)
    const { text, structured } = await callTool(viewer, "getReport", { report: `http://localhost:3000/s/${report.shareSlug}` })
    expect(structured).toMatchObject({ projectSlug: null, workspace: null })
    expect(text).not.toContain("Project slug:")
  })

  test("no project gives null", async () => {
    const report = await sampleReport({ projectId: null })
    const [space] = await ctx.db.select({ slug: workspace.slug }).from(workspace).where(eq(workspace.id, report.workspaceId))
    const { structured } = await callTool(client, "getReport", { report: `BB-${report.number}` })
    expect(structured).toMatchObject({ projectSlug: null, workspace: space?.slug })
  })

  test("works without debugger data", async () => {
    const report = await sampleReport({ debuggerKey: null })
    const { text, isError } = await callTool(client, "getReport", { report: report.id })
    expect(isError).toBe(false)
    expect(text).toContain("This report has no captured debugger data")
  })

  test("unknown reports answer Report not found", async () => {
    const { text, isError } = await callTool(client, "getReport", { report: "BB-999" })
    expect(isError).toBe(true)
    expect(text).toBe("Report not found")
  })
})

describe("nextSteps", () => {
  test("follows the summary", () => {
    expect(nextSteps({ ...SUMMARY, errors: 0, failedRequests: 0, actions: 0 })).toEqual(["getTimeline"])
    expect(nextSteps(SUMMARY)).toEqual([
      'getConsoleLogs levels=["error"]',
      "getCodeHotspots",
      "getNetworkRequests failedOnly=true",
      "getUserActions",
      "getReproductionScript",
      "getTimeline",
    ])
  })

  test("a video report also points to its recording", () => {
    expect(nextSteps({ ...SUMMARY, errors: 0, failedRequests: 0, actions: 0 }, "video")).toEqual(["getTimeline", "getRecording"])
  })
})

describe("getComments", () => {
  test("renders mentions as @Name and refuses viewers", async () => {
    const budi = await createUserWithToken(ctx.db, { name: "Budi" })
    const report = await sampleReport({ visibility: "public" })
    await ctx.db.insert(comment).values({ id: newId(), reportId: report.id, authorId: ana.user.id, body: `@[user:${budi.user.id}] cek ya` })
    const { text } = await callTool(client, "getComments", { report: report.id })
    expect(text).toContain("@Budi cek ya")
    expect(text).toContain("Ana")

    const outsider = await createUserWithToken(ctx.db, { workspaceId: null, email: "eve@kantor.test" })
    const refused = await callTool(await mcpClient(ctx.app, outsider.headers), "getComments", { report: report.id })
    expect(refused).toMatchObject({ isError: true, text: "Only members of this report's workspace can do this" })
  })
})

describe("getScreenshot", () => {
  const writeFile = (key: string, bytes: Uint8Array<ArrayBuffer>) => (ctx.storage as LocalStorageDriver).writeObject(key, bytes)

  test("returns an image for small screenshots and a link for large ones", async () => {
    const small = await sampleReport({ captureType: "screenshot", mediaType: "image/png" })
    await writeFile(small.mediaKey, new Uint8Array([137, 80, 78, 71]))
    const image = await callTool(client, "getScreenshot", { report: small.id })
    expect(image.images).toEqual([{ mimeType: "image/png", data: Buffer.from([137, 80, 78, 71]).toString("base64") }])

    const large = await sampleReport({ captureType: "screenshot", mediaType: "image/png" })
    await writeFile(large.mediaKey, new Uint8Array(2 * 1024 * 1024))
    const link = await callTool(client, "getScreenshot", { report: large.id })
    expect(link.images).toEqual([])
    expect(link.text).toContain("too large to send")
    expect(link.text).toContain("http")
  })

  test("a video report sends its thumbnail and points to the dashboard", async () => {
    const video = await sampleReport()
    const thumbnailKey = `reports/${video.id}/thumbnail.jpg`
    await writeFile(thumbnailKey, new Uint8Array([255, 216, 255]))
    const { db } = ctx
    const { report } = await import("../src/db/schema")
    const { eq } = await import("drizzle-orm")
    await db.update(report).set({ thumbnailKey }).where(eq(report.id, video.id))
    const result = await callTool(client, "getScreenshot", { report: video.id })
    expect(result.images[0]?.mimeType).toBe("image/jpeg")
    expect(result.text).toContain(`Watch the video in BugBerry: http://localhost:3000/app/r/${video.id}`)
  })
})

describe("getReport with unreadable debugger data", () => {
  test("says the data could not be read", async () => {
    const id = crypto.randomUUID()
    await createReadyReport(ctx.db, { id, reporterId: ana.user.id, debuggerKey: await putDebugger(ctx, id, "not json {") })
    const { text, isError } = await callTool(client, "getReport", { report: id })
    expect(isError).toBe(false)
    expect(text).toContain("This report's debugger data could not be read")
    expect(text).not.toContain("This report has no captured debugger data")
  })
})

describe("getReport and the app's BugBerry SDK", () => {
  const SDK_EVENTS = [
    { kind: "sdk" as const, t: T0 + 12_000, level: "info" as const, message: "Checkout started", data: '{"orderId":8812}', source: "checkout.js:40" },
    { kind: "sdk" as const, t: T0 + 13_000, level: "error" as const, message: "Payment declined", source: "checkout.js:52" },
  ]
  async function reportWith(extra: Record<string, unknown>) {
    const id = crypto.randomUUID()
    const payload = { ...samplePayload(), ...extra }
    await sampleReport({ id, debuggerKey: await putDebugger(ctx, id, payload) })
    return id
  }

  test("getReport prints the custom fields and suggests the SDK logs", async () => {
    const id = await reportWith({
      events: [...samplePayload().events, ...SDK_EVENTS],
      customFields: { fields: { userId: "u-1", flags: { newCheckout: true } }, error: null, droppedKeys: 1, url: "https://shop.test/checkout", t: T0 },
    })
    const { text, structured } = await callTool(client, "getReport", { report: id })
    expect(text).toContain("Custom fields (from the app's BugBerry SDK, taken on https://shop.test/checkout, an earlier page):")
    expect(text).toContain('  "userId": "u-1"')
    expect(text).toContain("+1 field over the 10 KB limit")
    expect(text).toContain('getConsoleLogs sources=["sdk"]')
    expect((structured as { customFields: unknown }).customFields).toEqual({ fields: { userId: "u-1", flags: { newCheckout: true } }, clipped: false, droppedKeys: 1, url: "https://shop.test/checkout", error: null })
  })

  test("fields from the last page and an error from it are both shown", async () => {
    const id = await reportWith({ customFields: { fields: { plan: "pro" }, error: "callback threw: late", droppedKeys: 0, url: null, t: T0 } })
    const { text } = await callTool(client, "getReport", { report: id })
    expect(text).toContain("Custom fields (from the app's BugBerry SDK):")
    expect(text).toContain("Last page: callback threw: late")
  })

  test("a report without custom fields has no block and no SDK hint", async () => {
    const { id } = await sampleReport()
    const { text, structured } = await callTool(client, "getReport", { report: id })
    expect(text).not.toContain("Custom fields")
    expect(text).not.toContain('sources=["sdk"]')
    expect((structured as { customFields: unknown }).customFields).toBeNull()
  })

  test("structured custom fields over 10 KB are left out, like the text that is cut", async () => {
    const fields = Object.fromEntries(Array.from({ length: 50 }, (_, n) => [`k${n}`, "z".repeat(1000)]))
    const id = await reportWith({ customFields: { fields, error: null, droppedKeys: 0, url: null, t: T0 } })
    const { structured } = await callTool(client, "getReport", { report: id })
    const custom = (structured as { customFields: { fields: unknown; clipped: boolean } }).customFields
    expect(custom.fields).toBeNull()
    expect(custom.clipped).toBe(true)
  })

  test("a failed callback is reported in words", async () => {
    const id = await reportWith({ customFields: { fields: null, error: "callback threw: store not ready", droppedKeys: 0, url: null, t: T0 } })
    const { text } = await callTool(client, "getReport", { report: id })
    expect(text).toContain("Custom fields: not captured (callback threw: store not ready)")
  })

  test("nextSteps puts the SDK logs right after the error steps, or first", () => {
    expect(nextSteps(SUMMARY, "screenshot", true).slice(0, 3)).toEqual(['getConsoleLogs levels=["error"]', "getCodeHotspots", 'getConsoleLogs sources=["sdk"]'])
    expect(nextSteps({ ...SUMMARY, errors: 0 }, "screenshot", true)[0]).toBe('getConsoleLogs sources=["sdk"]')
  })
})
