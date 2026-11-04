import { beforeEach, describe, expect, test } from "bun:test"
import type { DebuggerPayload } from "@bugberry/capture"
import { normalizePayload } from "@bugberry/debugger-view"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { eq } from "drizzle-orm"
import { reportActivity } from "../src/db/schema"
import { MAX_MOMENTS, recordingMoments } from "../src/mcp/recording"
import { replayFrameKeyFor } from "../src/storage/keys"
import type { LocalStorageDriver } from "../src/storage/local"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"
import { callTool, mcpClient, putDebugger, samplePayload, T0 } from "./mcp-helpers"

const view = (payload: DebuggerPayload) => normalizePayload(payload)

describe("recordingMoments", () => {
  test("marks page loads, the click before a failure with what failed, notes, rage clicks and navigations", () => {
    const moments = recordingMoments(view(samplePayload()), 30_000)
    expect(moments.map((moment) => moment.atMs)).toEqual([0, 5400, 6000, 7000, 20_000])

    const failure = moments[1]?.lines.join("\n") ?? ""
    for (const part of ["+00:05.0", "Pay now", "POST https://shop.test/api/orders → 500", "Order failed", "TypeError: x is undefined"]) {
      expect(failure).toContain(part)
    }
    expect(moments[0]?.lines.join("\n")).toContain("https://shop.test/checkout")
    expect(moments[2]?.lines.join("\n")).toContain("Note 1: Clicked pay twice (Ana)")
    expect(moments[3]?.lines.join("\n")).toContain("rage click")
    expect(moments[4]?.lines.join("\n")).toContain("https://shop.test/cart")
  })

  test("a click that nothing went wrong after is not a moment", () => {
    const payload = samplePayload()
    payload.events = [{ kind: "action", t: T0 + 2000, type: "click", target: 'button "Save"' }]
    payload.notes = []
    expect(recordingMoments(view(payload), 30_000)).toEqual([])
  })

  test("leaves out what falls outside the video", () => {
    const payload = samplePayload()
    payload.notes = []
    payload.events = [
      { kind: "error", t: T0 - 500, message: "before the start" },
      { kind: "error", t: T0 + 3000, message: "inside" },
      { kind: "error", t: T0 + 31_000, message: "after the end" },
    ]
    const moments = recordingMoments(view(payload), 30_000)
    expect(moments.map((moment) => moment.lines.join(" "))).toEqual([expect.stringContaining("inside")])
  })

  test(`keeps at most ${MAX_MOMENTS}, problems before navigations`, () => {
    const payload = samplePayload()
    payload.notes = []
    payload.events = [
      ...Array.from({ length: 30 }, (_, index) => ({
        kind: "action" as const,
        t: T0 + index * 2000,
        type: "navigate" as const,
        url: `https://shop.test/page/${index}`,
        via: "history" as const,
      })),
      { kind: "error", t: T0 + 59_500, message: "late error" },
    ]
    const moments = recordingMoments(view(payload), 60_000)
    expect(moments).toHaveLength(MAX_MOMENTS)
    expect(moments.at(-1)?.lines.join(" ")).toContain("late error")
    expect(moments.map((moment) => moment.atMs)).toEqual([...moments.map((moment) => moment.atMs)].sort((a, b) => a - b))
  })

  test("without a recording start, only the notes have a place in the video", () => {
    const payload = samplePayload()
    payload.recordingStartedAt = null
    // Older payloads may lack both times; the view then has no base to place events against.
    ;(payload as { capturedAt: number | null }).capturedAt = null
    expect(recordingMoments(view(payload), 30_000).map((moment) => moment.atMs)).toEqual([6000])
  })
})

describe("getRecording", () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>
  let ana: Awaited<ReturnType<typeof createUserWithToken>>
  let client: Client

  beforeEach(async () => {
    ctx = await setupTestApp()
    ana = await createUserWithToken(ctx.db, { name: "Ana" })
    client = await mcpClient(ctx.app, ana.headers)
  })

  async function videoReport(opts: { debugger?: boolean; file?: boolean } = {}) {
    const id = crypto.randomUUID()
    const mediaKey = `reports/${id}/media.webm`
    if (opts.file !== false) await (ctx.storage as LocalStorageDriver).writeObject(mediaKey, new Uint8Array(2048))
    return createReadyReport(ctx.db, {
      id,
      reporterId: ana.user.id,
      title: "Pay fails",
      captureType: "video",
      mediaKey,
      mediaType: "video/webm",
      durationMs: 30_000,
      ...(opts.debugger === false ? {} : { debuggerKey: await putDebugger(ctx, id, samplePayload()) }),
    })
  }

  /** A 30 s replay with a frame every 5 s, so samplePayload's moments at 5.4, 6, 7 and 20 s land on known frames. */
  async function replayReport(frames: number[] = [0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000]) {
    const id = crypto.randomUUID()
    const mediaKey = `reports/${id}/media.json.gz`
    const storage = ctx.storage as LocalStorageDriver
    await storage.writeObject(mediaKey, new Uint8Array(64))
    for (const [index] of frames.entries()) await storage.writeObject(replayFrameKeyFor(id, index), new Uint8Array(32))
    return createReadyReport(ctx.db, {
      id,
      reporterId: ana.user.id,
      title: "Flash",
      captureType: "replay",
      mediaKey,
      mediaType: "application/gzip",
      durationMs: 30_000,
      replayFrames: frames,
      debuggerKey: await putDebugger(ctx, id, samplePayload()),
    })
  }

  test("a replay lists its frames with links and maps each moment to the frame before it", async () => {
    const report = await replayReport()
    const { text, structured, isError } = await callTool(client, "getRecording", { report: report.id })
    expect(isError).toBe(false)
    expect(text).toContain(`BB-${report.number} "Flash" is a replay of about 30.0s: 7 screenshots taken every 5 s while the tab was armed`)
    expect(text).toContain("→ frame 1 (5.0s)")
    expect(text).toMatch(/frame 4 at 20\.0s: http:\/\/localhost:3000\/api\/files\//)
    expect(text).toContain(`Links expire in 5 minutes. Read the report in BugBerry: http://localhost:3000/app/r/${report.id}`)
    expect(text).not.toContain("ffmpeg")
    const result = structured as {
      kind: string
      expiresInSeconds: number
      frames: Array<{ index: number; atMs: number; seconds: string; url: string }>
      moments: Array<{ atMs: number; frameIndex: number | null }>
    }
    expect(result).toMatchObject({ kind: "replay", expiresInSeconds: 300, durationMs: 30_000 })
    expect(result.frames).toHaveLength(7)
    expect(result.frames[1]).toMatchObject({ index: 1, atMs: 5_000, seconds: "5.0" })
    expect(result.frames[1]?.url).toContain("/api/files/")
    expect(result.moments.map((moment) => [moment.atMs, moment.frameIndex])).toEqual([
      [0, 0],
      [5400, 1],
      [6000, 1],
      [7000, 1],
      [20_000, 4],
    ])
  })

  test("a moment before the first frame has no frame", async () => {
    const report = await replayReport([6_500])
    const { text, structured } = await callTool(client, "getRecording", { report: report.id })
    expect(text).toContain("→ no frame before this moment")
    expect((structured as { moments: Array<{ atMs: number; frameIndex: number | null }> }).moments[0]).toMatchObject({ atMs: 0, frameIndex: null })
  })

  test("a replay without frames points at getTimeline", async () => {
    const report = await replayReport([])
    const { text } = await callTool(client, "getRecording", { report: report.id })
    expect(text).toBe(`BB-${report.number} is a replay with no screenshots: the tab was hidden while it was armed. Use getTimeline for what happened.`)
  })

  test("gives a short-lived link, the moments in video time and the commands to cut their frames", async () => {
    const report = await videoReport()
    const { text, structured, isError } = await callTool(client, "getRecording", { report: `BB-${report.number}` })
    expect(isError).toBe(false)
    for (const part of [
      "http://localhost:3000/api/files/",
      "5 minutes",
      "+00:05.4",
      "POST https://shop.test/api/orders → 500",
      `ffmpeg -v error -y -ss 5.4 -i bb-${report.number}.webm -frames:v 1 bb-${report.number}-0005.4s.jpg`,
      "Delete the video",
      `http://localhost:3000/app/r/${report.id}`,
    ]) {
      expect(text).toContain(part)
    }
    expect(structured).toMatchObject({
      expiresInSeconds: 300,
      durationMs: 30_000,
      mediaType: "video/webm",
      sizeBytes: 2048,
      moments: expect.arrayContaining([expect.objectContaining({ atMs: 5400, seconds: 5.4 })]),
    })
    expect((structured as { url: string }).url).toStartWith("http://localhost:3000/api/files/")
  })

  test("notes that the agent read the recording", async () => {
    const report = await videoReport()
    await callTool(client, "getRecording", { report: report.id })
    const [row] = await ctx.db.select().from(reportActivity).where(eq(reportActivity.reportId, report.id))
    expect(row?.detail).toEqual({ parts: ["recording"] })
  })

  test("without debugger data the link still comes, with no moments", async () => {
    const report = await videoReport({ debugger: false })
    const { text, isError } = await callTool(client, "getRecording", { report: report.id })
    expect(isError).toBe(false)
    expect(text).toContain("http://localhost:3000/api/files/")
    expect(text).toContain("No moments")
  })

  test("a screenshot report points to getScreenshot", async () => {
    const id = crypto.randomUUID()
    await createReadyReport(ctx.db, { id, reporterId: ana.user.id, captureType: "screenshot", mediaKey: `reports/${id}/media.png`, mediaType: "image/png" })
    const { text, isError } = await callTool(client, "getRecording", { report: id })
    expect(isError).toBe(false)
    expect(text).toContain("getScreenshot")
    expect(text).not.toContain("/api/files/")
  })

  test("a missing video file says so", async () => {
    const report = await videoReport({ file: false })
    const { text } = await callTool(client, "getRecording", { report: report.id })
    expect(text).toContain("The video file is missing")
    expect(text).not.toContain("/api/files/")
  })
})
