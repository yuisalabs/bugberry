import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { comment } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { nextSteps } from "../src/mcp/tools/report-read"
import type { LocalStorageDriver } from "../src/storage/local"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient, putDebugger, samplePayload } from "./mcp-helpers"

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
      "getTimeline",
    ])
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
