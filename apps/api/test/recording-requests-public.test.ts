import { beforeEach, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { report, user, workspace, workspaceMember } from "../src/db/schema"
import { createProject, createUserWithToken, putUpload, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let maker: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string
let token: string
let requestId: string

type Who = { headers: Record<string, string> }
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  ctx.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
const json = async (response: Response) => (await response.json()) as any

async function makeLink(who: Who = maker, body: Record<string, unknown> = {}) {
  const response = await ctx.app.handle(
    new Request("http://localhost/api/recording-requests", {
      method: "POST",
      headers: { ...who.headers, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: ctx.workspace.id, projectId, expiresInDays: 7, maxUses: 5, ...body }),
    }),
  )
  const made = await json(response)
  if (!made.url) throw new Error(JSON.stringify(made))
  return { id: made.id as string, token: (made.url as string).split("/").pop() as string }
}

const lookup = (t: string) => call("GET", `/api/recording-requests/by-token/${t}`)
const device = { browser: "Chrome 131", os: "Windows 11", viewport: "1440x900" }
const video = { name: "Budi", captureType: "video", durationMs: 4000, mediaSize: 4, device }
const start = (t: string, body: Record<string, unknown> = video, headers: Record<string, string> = {}) =>
  call("POST", `/api/recording-requests/by-token/${t}/uploads`, body, headers)
const reportCount = async () => {
  const [row] = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM report`)) as unknown as Array<{ n: number }>
  return row?.n ?? 0
}

beforeEach(async () => {
  ctx = await setupTestApp({ appUrl: "https://bb.test", allowedEmailDomains: [], maxUploadBytes: 300 * 1024 * 1024 })
  await ctx.db.update(workspace).set({ name: "Acme QA" }).where(eq(workspace.id, ctx.workspace.id))
  maker = await createUserWithToken(ctx.db, { role: "member", name: "Ana", email: "ana@acme.test" })
  projectId = (await createProject(ctx.db, { name: "Storefront" })).id
  const made = await makeLink(maker, { note: "The checkout bug, please", pageUrl: "https://shop.test/cart" })
  token = made.token
  requestId = made.id
})

describe("reading a link", () => {
  test("a live link says who asks and what fits", async () => {
    const response = await lookup(token)
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      workspaceName: "Acme QA",
      requesterName: "Ana",
      note: "The checkout bug, please",
      pageUrl: "https://shop.test/cart",
      maxSeconds: 300,
      maxBytes: 95 * 1024 * 1024,
    })
  })

  test("the workspace's own recording limit lowers maxSeconds", async () => {
    ctx = await setupTestApp({ appUrl: "https://bb.test", allowedEmailDomains: [], accountLimits: { screenshots: 5, recordings: 5, ownedWorkspaces: 1, recordingMs: 120_000 } })
    maker = await createUserWithToken(ctx.db, { role: "member", name: "Ana" })
    projectId = (await createProject(ctx.db)).id
    const made = await makeLink()
    expect((await json(await lookup(made.token))).maxSeconds).toBe(120)
  })

  test("unknown, expired, revoked and used-up links answer the same 404", async () => {
    const expired = await makeLink()
    await ctx.db.execute(sql`UPDATE recording_request SET expires_at = now() - interval '1 minute' WHERE id = ${expired.id}`)
    const revoked = await makeLink()
    await ctx.db.execute(sql`UPDATE recording_request SET revoked_at = now() WHERE id = ${revoked.id}`)
    const usedUp = await makeLink(maker, { maxUses: 1 })
    expect((await start(usedUp.token)).status).toBe(200)
    const answers = await Promise.all(["nope-nope", expired.token, revoked.token, usedUp.token].map((t) => lookup(t)))
    expect(answers.map((a) => a.status)).toEqual([404, 404, 404, 404])
    const bodies = await Promise.all(answers.map((a) => a.text()))
    expect(new Set(bodies).size).toBe(1)
    expect(JSON.parse(bodies[0] as string)).toMatchObject({ code: "request_unavailable", message: "This link doesn't take recordings." })
  })

  test("a link whose maker left the workspace or was deactivated is unavailable", async () => {
    await ctx.db.delete(workspaceMember).where(eq(workspaceMember.userId, maker.user.id))
    expect((await lookup(token)).status).toBe(404)
    expect((await start(token)).status).toBe(404)
    const other = await createUserWithToken(ctx.db, { role: "member" })
    const theirs = await makeLink(other)
    await ctx.db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, other.user.id))
    expect((await lookup(theirs.token)).status).toBe(404)
  })

  test("a session sent along changes nothing", async () => {
    const response = await call("GET", `/api/recording-requests/by-token/${token}`, undefined, maker.headers)
    expect((await json(response)).requesterName).toBe("Ana")
  })
})

describe("starting an upload", () => {
  test("starting an upload makes a report in the maker's name with the sender on it", async () => {
    const response = await start(token, { ...video, name: "  Budi  ", email: "budi@client.test", description: "It spins" })
    expect(response.status).toBe(200)
    const started = await json(response)
    const [row] = await ctx.db.select().from(report)
    expect(row).toMatchObject({
      reporterId: maker.user.id,
      senderName: "Budi",
      senderEmail: "budi@client.test",
      recordingRequestId: requestId,
      title: "Bugcord by Budi",
      description: "It spins",
      visibility: "workspace",
      projectId,
      uploadStatus: "uploading",
      pageUrl: "https://shop.test/cart",
    })
    expect(started.uploadToken).toBeTruthy()
    expect(started.mediaUpload.method).toBe("PUT")
    expect(started.thumbnailUpload).toBeNull()
  })

  test("the sender's page address wins over the link's", async () => {
    await start(token, { ...video, pageUrl: "https://shop.test/pay" })
    const [row] = await ctx.db.select({ pageUrl: report.pageUrl }).from(report)
    expect(row?.pageUrl).toBe("https://shop.test/pay")
  })

  test("the ticket uploads and finalizes that report and no other", async () => {
    const started = await json(await start(token))
    expect((await putUpload(ctx.app, started.mediaUpload, new Uint8Array([1, 2, 3, 4]))).ok).toBe(true)
    const done = await call("POST", `/api/agent-uploads/${started.uploadToken}/finalize`)
    expect(done.status).toBe(200)
    const [row] = await ctx.db.select({ uploadStatus: report.uploadStatus }).from(report)
    expect(row?.uploadStatus).toBe("ready")
  })

  test("uses: the sixth start on a five-use link is unavailable; a failed upload gives its use back", async () => {
    for (let i = 0; i < 5; i++) expect((await start(token)).status).toBe(200)
    expect((await start(token)).status).toBe(404)
    await ctx.db.execute(sql`UPDATE report SET upload_status = 'failed' WHERE id = (SELECT id FROM report LIMIT 1)`)
    expect((await start(token)).status).toBe(200)
  })

  test("two starts at once on a link with one use left: one wins", async () => {
    const lastUse = await makeLink(maker, { maxUses: 1 })
    const answers = await Promise.all([start(lastUse.token), start(lastUse.token)])
    expect(answers.map((a) => a.status).sort()).toEqual([200, 404])
  })

  test("too big, too long, a replay, a name of spaces, a two-line name: refused, and no report row is made", async () => {
    const big = await start(token, { ...video, mediaSize: 95 * 1024 * 1024 + 1 })
    expect(big.status).toBe(413)
    const long = await start(token, { ...video, durationMs: 305_001 })
    expect(long.status).toBe(422)
    expect((await json(long)).code).toBe("recording_too_long")
    expect((await start(token, { ...video, captureType: "replay" })).status).toBe(422)
    expect((await start(token, { ...video, name: "   " })).status).toBe(422)
    expect((await start(token, { ...video, name: "Budi\nEvil" })).status).toBe(422)
    expect((await start(token, { ...video, name: "x".repeat(81) })).status).toBe(422)
    expect((await start(token, { ...video, pageUrl: "javascript:alert(1)" })).status).toBe(422)
    expect(await reportCount()).toBe(0)
  })

  test("a recording the time limit stopped a moment late is taken", async () => {
    expect((await start(token, { ...video, durationMs: 300_050 })).status).toBe(200)
  })

  test("an upload that can no longer be finished gives its use back", async () => {
    const one = await makeLink(maker, { maxUses: 1 })
    expect((await start(one.token)).status).toBe(200)
    expect((await start(one.token)).status).toBe(404)
    await ctx.db.execute(sql`UPDATE report SET created_at = now() - interval '2 hours' WHERE recording_request_id = ${one.id}`)
    expect((await lookup(one.token)).status).toBe(200)
    expect((await start(one.token)).status).toBe(200)
  })

  test("a server whose MAX_UPLOAD_MB is lower than 95 tells the sender that size", async () => {
    ctx = await setupTestApp({ appUrl: "https://bb.test", allowedEmailDomains: [], maxUploadBytes: 10 * 1024 * 1024 })
    maker = await createUserWithToken(ctx.db, { role: "member", name: "Ana" })
    projectId = (await createProject(ctx.db)).id
    const made = await makeLink()
    expect((await json(await lookup(made.token))).maxBytes).toBe(10 * 1024 * 1024)
    expect((await start(made.token, { ...video, mediaSize: 10 * 1024 * 1024 + 1 })).status).toBe(413)
    expect(await reportCount()).toBe(0)
  })

  test("an email that would add fields to a mailto link is refused", async () => {
    for (const email of ["budi?cc=boss@client.test", "budi&body=hi@client.test", "budi%3F@client.test"]) {
      const refused = await start(token, { ...video, email })
      expect(refused.status).toBe(422)
    }
    expect(await reportCount()).toBe(0)
  })

  test("the ticket and finalize tell the sender nothing of the report", async () => {
    const started = await json(await start(token))
    const ticket = await json(await call("GET", `/api/agent-uploads/${started.uploadToken}`))
    expect(ticket.mediaUpload).toBeTruthy()
    expect(ticket.reportId).toBeUndefined()
    expect(ticket.number).toBeUndefined()
    await putUpload(ctx.app, started.mediaUpload, new Uint8Array([1, 2, 3, 4]))
    const done = await call("POST", `/api/agent-uploads/${started.uploadToken}/finalize`)
    expect(done.status).toBe(200)
    expect(await json(done)).toEqual({ uploadStatus: "ready" })
  })

  test("a screenshot needs no length", async () => {
    expect((await start(token, { name: "Budi", captureType: "screenshot", mediaSize: 4, device })).status).toBe(200)
  })
})

describe("limits per address", () => {
  test("the 11th start in an hour from one address is 429; so is the 31st lookup in a minute", async () => {
    ctx = await setupTestApp({ appUrl: "https://bb.test", allowedEmailDomains: [], proxyHops: 1 })
    maker = await createUserWithToken(ctx.db, { role: "member", name: "Ana" })
    projectId = (await createProject(ctx.db)).id
    const made = await makeLink(maker, { maxUses: 20 })
    const from = { "x-forwarded-for": "203.0.113.9" }
    for (let i = 0; i < 10; i++) expect((await start(made.token, video, from)).status).toBe(200)
    expect((await start(made.token, video, from)).status).toBe(429)
    expect((await start(made.token, video, { "x-forwarded-for": "203.0.113.10" })).status).toBe(200)
    for (let i = 0; i < 30; i++) expect((await call("GET", `/api/recording-requests/by-token/${made.token}`, undefined, from)).status).toBe(200)
    expect((await call("GET", `/api/recording-requests/by-token/${made.token}`, undefined, from)).status).toBe(429)
  })
})

test("the answers hold no workspace id, project id or email", async () => {
  const read = await (await lookup(token)).text()
  const started = await (await start(token, { ...video, email: "budi@client.test" })).text()
  for (const text of [read, started]) {
    expect(text).not.toContain(ctx.workspace.id)
    expect(text).not.toContain(projectId)
    expect(text).not.toContain("ana@acme.test")
    expect(text).not.toContain("budi@client.test")
  }
})
