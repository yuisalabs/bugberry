import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { CurrentUser } from "../src/auth/plugin"
import { agentUpload, report } from "../src/db/schema"
import { AGENT_UPLOAD_TTL_MS, issueAgentUpload } from "../src/modules/reports/agent-uploads"
import { createReportUpload } from "../src/modules/reports/upload-flow"
import { createProject, createUserWithToken, putUpload, setupTestApp, uploadBody } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let reporter: CurrentUser
let projectId: string
let followUps: number

beforeEach(async () => {
  followUps = 0
  ctx = await setupTestApp({}, { background: () => void followUps++ })
  const { user } = await createUserWithToken(ctx.db)
  reporter = { id: user.id, email: user.email, name: user.name, image: user.image ?? null, lastWorkspaceId: user.lastWorkspaceId ?? null }
  projectId = (await createProject(ctx.db)).id
})

const MEDIA = new Uint8Array([1, 2, 3, 4])
const DEBUGGER = new Uint8Array([9, 9])

/** A video report waiting for its files, and an upload link to it issued at `issuedAt`. */
async function ticket(issuedAt = new Date()) {
  const created = await createReportUpload(
    ctx,
    reporter,
    uploadBody(projectId, { captureType: "video", durationMs: 3000, mediaSize: MEDIA.length, debuggerSize: DEBUGGER.length }),
    { viaAgent: "Claude Code" },
  )
  const { token } = await issueAgentUpload(ctx.db, created.reportId, reporter.id, issuedAt)
  return { reportId: created.reportId, token }
}

const linkGet = (token: string) => ctx.app.handle(new Request(`http://localhost/api/agent-uploads/${token}`))
const linkFinalize = (token: string) =>
  ctx.app.handle(new Request(`http://localhost/api/agent-uploads/${token}/finalize`, { method: "POST" }))

async function sendFiles(token: string) {
  const targets = (await (await linkGet(token)).json()) as { mediaUpload: never; debuggerUpload: never }
  expect((await putUpload(ctx.app, targets.mediaUpload, MEDIA)).ok).toBe(true)
  expect((await putUpload(ctx.app, targets.debuggerUpload, DEBUGGER)).ok).toBe(true)
}

async function statusOf(id: string) {
  const [row] = await ctx.db.select({ uploadStatus: report.uploadStatus }).from(report).where(eq(report.id, id))
  return row?.uploadStatus
}

describe("agent upload links", () => {
  test("GET returns fresh PUT targets for the ticket's report", async () => {
    const { reportId, token } = await ticket()
    const response = await linkGet(token)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, { method: string } | null> & { reportId: string }
    expect(body.reportId).toBe(reportId)
    expect(body.mediaUpload?.method).toBe("PUT")
    expect(body.debuggerUpload?.method).toBe("PUT")
  })

  test("unknown token is not found", async () => {
    const response = await linkGet("nope")
    expect(response.status).toBe(404)
    expect(((await response.json()) as { code: string }).code).toBe("upload_link_unknown")
  })

  test("expired token is gone", async () => {
    const { token } = await ticket(new Date(Date.now() - AGENT_UPLOAD_TTL_MS - 60_000))
    const response = await linkGet(token)
    expect(response.status).toBe(410)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe("upload_link_expired")
    expect(body.message).toBe("This upload link expired. Call createUpload again.")
  })

  test("finalize makes the report ready and notifies once", async () => {
    const { reportId, token } = await ticket()
    await sendFiles(token)
    const response = await linkFinalize(token)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { uploadStatus: string }).uploadStatus).toBe("ready")
    expect(await statusOf(reportId)).toBe("ready")
    expect(followUps).toBe(1)
  })

  test("finalize twice is idempotent", async () => {
    const { token } = await ticket()
    await sendFiles(token)
    await linkFinalize(token)
    const again = await linkFinalize(token)
    expect(again.status).toBe(200)
    expect(((await again.json()) as { uploadStatus: string }).uploadStatus).toBe("ready")
    expect(followUps).toBe(1)
  })

  test("GET after finalize says the link was used", async () => {
    const { token } = await ticket()
    await sendFiles(token)
    await linkFinalize(token)
    const response = await linkGet(token)
    expect(response.status).toBe(410)
    expect(((await response.json()) as { code: string }).code).toBe("upload_link_used")
  })

  test("a token for one report cannot touch another", async () => {
    const first = await ticket()
    const second = await ticket()
    const body = (await (await linkGet(first.token)).json()) as { reportId: string }
    expect(body.reportId).toBe(first.reportId)
    expect(body.reportId).not.toBe(second.reportId)
    await sendFiles(first.token)
    await linkFinalize(first.token)
    expect(await statusOf(second.reportId)).toBe("uploading")
  })
  test("GET gives no targets once the report is no longer waiting for files", async () => {
    const { reportId, token } = await ticket()
    await ctx.db.update(report).set({ uploadStatus: "ready" }).where(eq(report.id, reportId))
    const ready = await linkGet(token)
    expect(ready.status).toBe(410)
    expect(((await ready.json()) as { code: string }).code).toBe("upload_link_used")

    await ctx.db.update(report).set({ uploadStatus: "failed", uploadError: "sizes differ" }).where(eq(report.id, reportId))
    const failed = await linkGet(token)
    expect(failed.status).toBe(422)
    const body = (await failed.json()) as { code: string; message: string }
    expect(body.code).toBe("upload_failed")
    expect(body.message).toContain("Call createUpload again")
  })

  test("finalize still works after the link expired, while its upload targets could still be used", async () => {
    const { reportId, token } = await ticket()
    await sendFiles(token)
    await ctx.db.update(agentUpload).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(agentUpload.reportId, reportId))
    const response = await linkFinalize(token)
    expect(response.status).toBe(200)
    expect(await statusOf(reportId)).toBe("ready")
  })

  test("finalize is refused once the targets the link gave have expired too", async () => {
    const { reportId, token } = await ticket()
    await sendFiles(token)
    const pastTargets = Date.now() - ctx.config.uploadUrlTtlSeconds * 1000 - 60_000
    await ctx.db.update(agentUpload).set({ expiresAt: new Date(pastTargets) }).where(eq(agentUpload.reportId, reportId))
    const response = await linkFinalize(token)
    expect(response.status).toBe(410)
    expect(((await response.json()) as { code: string }).code).toBe("upload_link_expired")
  })
})
