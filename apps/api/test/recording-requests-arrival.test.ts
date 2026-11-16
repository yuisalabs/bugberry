import { beforeEach, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import type { EmailMessage } from "../src/lib/email/sender"
import { notification, report, workspace } from "../src/db/schema"
import { receivedEmail } from "../src/modules/requests/received-email"
import { createIntegration, createProject, createUserWithToken, type FakeTrackers, fakeTrackers, putUpload, setupTestApp, waitFor } from "./helpers"
import { callTool, mcpClient } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let maker: Awaited<ReturnType<typeof createUserWithToken>>
let trackers: FakeTrackers
let outbox: EmailMessage[]
let pending: Promise<unknown>[]
let projectId: string

const json = async (response: Response) => (await response.json()) as any
const settle = async () => {
  while (pending.length > 0) await Promise.all(pending.splice(0))
}

beforeEach(async () => {
  trackers = fakeTrackers()
  outbox = []
  pending = []
  ctx = await setupTestApp(
    { appUrl: "https://bb.test", allowedEmailDomains: [] },
    { trackers: trackers.factory, email: { send: async (message) => void outbox.push(message) }, background: (task) => void pending.push(task) },
  )
  await ctx.db.update(workspace).set({ name: "Acme QA" }).where(eq(workspace.id, ctx.workspace.id))
  maker = await createUserWithToken(ctx.db, { role: "member", name: "Ana", email: "ana@acme.test" })
  projectId = (await createProject(ctx.db, { name: "Storefront" })).id
  await createIntegration(ctx.db, { projectId, provider: "github", target: { owner: "acme", repo: "web", labels: [] }, secret: "ghp", autoSend: true })
})

/** A recording sent through a fresh link and finalized; returns the report's id and its ticket. */
async function sendThroughLink(sender: Record<string, unknown> = {}) {
  const made = await json(
    await ctx.app.handle(
      new Request("http://localhost/api/recording-requests", {
        method: "POST",
        headers: { ...maker.headers, "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: ctx.workspace.id, projectId, expiresInDays: 7, maxUses: 5 }),
      }),
    ),
  )
  const token = made.url.split("/").pop()
  const started = await json(
    await ctx.app.handle(
      new Request(`http://localhost/api/recording-requests/by-token/${token}/uploads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Budi",
          email: "budi@client.test",
          captureType: "video",
          durationMs: 4000,
          mediaSize: 4,
          device: { browser: "Chrome", os: "Windows", viewport: "1440x900" },
          ...sender,
        }),
      }),
    ),
  )
  await putUpload(ctx.app, started.mediaUpload, new Uint8Array([1, 2, 3, 4]))
  const finalize = () => ctx.app.handle(new Request(`http://localhost/api/agent-uploads/${started.uploadToken}/finalize`, { method: "POST" }))
  expect((await finalize()).status).toBe(200)
  const [row] = await ctx.db.select({ id: report.id, number: report.number, shareSlug: report.shareSlug }).from(report).where(eq(report.senderName, String(sender.name ?? "Budi")))
  if (!row) throw new Error("no report")
  return { ...row, finalize }
}

describe("when a recording arrives", () => {
  test("a recording from a link is not sent to trackers by itself", async () => {
    await sendThroughLink()
    await settle()
    expect(trackers.created).toEqual([])
  })

  test("the same project still auto-sends a member's own report", async () => {
    const { createReportUpload, finalizeReportUpload } = await import("../src/modules/reports/upload-flow")
    const { createDispatcher } = await import("../src/modules/trackers/dispatch")
    const { uploadBody } = await import("./helpers")
    const caller = { id: maker.user.id, email: maker.user.email, name: maker.user.name, image: null, lastWorkspaceId: null }
    const created = await createReportUpload(ctx, caller, uploadBody(projectId, { captureType: "screenshot", mediaSize: 4 }))
    await putUpload(ctx.app, created.mediaUpload as never, new Uint8Array([1, 2, 3, 4]))
    await finalizeReportUpload(ctx, createDispatcher({ ...ctx, trackers: trackers.factory }), created.reportId)
    // Called without the app's background hook, so the work is waited for here.
    await waitFor(async () => trackers.created.length > 0)
    expect(trackers.created).toHaveLength(1)
  })

  test("the maker gets a bell notification and an email, once, even when finalize is called twice", async () => {
    const sent = await sendThroughLink()
    expect((await sent.finalize()).status).toBe(200)
    await settle()
    const rows = await ctx.db.select().from(notification).where(eq(notification.userId, maker.user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: "recording_received", actorId: null, commentId: null, reportId: sent.id })
    expect(outbox).toHaveLength(1)
    expect(outbox[0]).toMatchObject({ to: "ana@acme.test", subject: `Budi sent the recording you asked for (BB-${sent.number})` })
    expect(outbox[0]?.text).toContain(`https://bb.test/app/r/${sent.id}`)
  })

  test("the bell names who sent it", async () => {
    const sent = await sendThroughLink()
    await settle()
    const bell = await json(await ctx.app.handle(new Request("http://localhost/api/notifications", { headers: maker.headers })))
    expect(bell.items).toMatchObject([{ kind: "recording_received", actor: null, senderName: "Budi", report: { id: sent.id } }])
  })

  test("members see the sender's name and email; a share viewer sees the name only", async () => {
    const sent = await sendThroughLink()
    const detail = await json(await ctx.app.handle(new Request(`http://localhost/api/reports/${sent.id}`, { headers: maker.headers })))
    expect(detail.sender).toEqual({ name: "Budi", email: "budi@client.test" })
    await ctx.db.execute(sql`UPDATE report SET visibility = 'public' WHERE id = ${sent.id}`)
    const shared = await json(await ctx.app.handle(new Request(`http://localhost/api/share/${sent.shareSlug}`)))
    expect(shared.report?.sender ?? shared.sender).toEqual({ name: "Budi" })
  })

  test("a member's own report has no sender", async () => {
    const sent = await sendThroughLink()
    await ctx.db.execute(sql`UPDATE report SET sender_name = NULL, sender_email = NULL, recording_request_id = NULL WHERE id = ${sent.id}`)
    const detail = await json(await ctx.app.handle(new Request(`http://localhost/api/reports/${sent.id}`, { headers: maker.headers })))
    expect(detail.sender).toBeNull()
  })

  test("the list item names the sender", async () => {
    await sendThroughLink()
    const list = await json(await ctx.app.handle(new Request(`http://localhost/api/reports?workspaceId=${ctx.workspace.id}`, { headers: maker.headers })))
    expect(list.items[0].senderName).toBe("Budi")
  })

  test("MCP's getReport says it came through a request link", async () => {
    const sent = await sendThroughLink()
    const client = await mcpClient(ctx.app, maker.headers)
    const answer = await callTool(client, "getReport", { report: `BB-${sent.number}` })
    expect(answer.text).toContain("Sent by Budi through a request link (not a workspace member).")
  })
})

describe("the requester's email", () => {
  test("the email shows a name with markup as text", () => {
    const email = receivedEmail({
      senderName: "<img src=x onerror=alert(1)>",
      reportNumber: 3,
      reportTitle: "t",
      reportUrl: "https://bb.test/app/r/1",
      workspaceName: "Acme",
    })
    expect(email.html).not.toContain("<img")
    expect(email.html).toContain("&lt;img")
    expect(email.subject).toBe("<img src=x onerror=alert(1)> sent the recording you asked for (BB-3)")
  })
})
