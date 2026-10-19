import { beforeEach, describe, expect, test } from "bun:test"
import { MAX_EVENTS } from "@bugberry/debugger-view"
import { createDebuggerCache, loadDebuggerView } from "../src/mcp/debugger"
import { resolveReportRef } from "../src/mcp/refs"
import type { LocalStorageDriver } from "../src/storage/local"
import { createReadyReport, createUser, setupTestApp } from "./helpers"
import { putDebugger, samplePayload, testMcpContext } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUser>>

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUser(ctx.db)
})

async function reportWith(payload: unknown) {
  const id = crypto.randomUUID()
  const debuggerKey = payload === null ? null : await putDebugger(ctx, id, payload)
  await createReadyReport(ctx.db, { id, reporterId: ana.id, debuggerKey })
  const mcp = testMcpContext(ctx, ana)
  return { mcp, resolved: await resolveReportRef(mcp, id) }
}

describe("loadDebuggerView", () => {
  test("returns the normalized payload", async () => {
    const { mcp, resolved } = await reportWith(samplePayload())
    const view = await loadDebuggerView(mcp, resolved)
    expect(view?.events.length).toBe(10)
    expect(view?.notes[0]?.text).toBe("Clicked pay twice")
  })

  test("returns null without a debugger key", async () => {
    const { mcp, resolved } = await reportWith(null)
    expect(await loadDebuggerView(mcp, resolved)).toBeNull()
  })

  test("returns null for invalid JSON and payloads over 16 MB", async () => {
    for (const bad of ["not json {", " ".repeat(17 * 1024 * 1024)]) {
      const { mcp, resolved } = await reportWith(bad)
      expect(await loadDebuggerView(mcp, resolved)).toBeNull()
    }
  })

  test("returns null for a file that is not gzip", async () => {
    const id = crypto.randomUUID()
    const key = `reports/${id}/debugger.json.gz`
    await (ctx.storage as LocalStorageDriver).writeObject(key, new TextEncoder().encode("plain"))
    await createReadyReport(ctx.db, { id, reporterId: ana.id, debuggerKey: key })
    const mcp = testMcpContext(ctx, ana)
    expect(await loadDebuggerView(mcp, await resolveReportRef(mcp, id))).toBeNull()
  })

  test("normalizes hostile values", async () => {
    const { mcp, resolved } = await reportWith({ events: [{ kind: "console", t: 1, args: [{}] }, "x", null, 5] })
    expect(await loadDebuggerView(mcp, resolved)).not.toBeNull()
  })

  test("caps 50,000 events at MAX_EVENTS", async () => {
    const events = Array.from({ length: 50_000 }, (_, n) => ({ kind: "console", t: n, level: "log", args: [`line ${n}`] }))
    const { mcp, resolved } = await reportWith({ events })
    const view = await loadDebuggerView(mcp, resolved)
    expect(view?.events.length).toBe(MAX_EVENTS)
  })

  test("caches by report and key and expires after the TTL", async () => {
    let now = 0
    let reads = 0
    const storage = ctx.storage
    const counting = Object.assign(Object.create(Object.getPrototypeOf(storage)), storage, {
      read: (key: string) => {
        reads++
        return storage.read(key)
      },
    }) as typeof storage
    const { resolved } = await reportWith(samplePayload())
    const mcp = testMcpContext(ctx, ana, {
      deps: { ...ctx, storage: counting },
      cache: createDebuggerCache({ ttlMs: 1000, now: () => now }),
    })
    await loadDebuggerView(mcp, resolved)
    await loadDebuggerView(mcp, resolved)
    expect(reads).toBe(1)
    now = 2000
    await loadDebuggerView(mcp, resolved)
    expect(reads).toBe(2)
  })
})
