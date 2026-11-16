import { beforeEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { recordingRequest } from "../src/db/schema"
import { requestStatus, requestUrl } from "../src/modules/requests/service"
import { createProject, createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let other: Awaited<ReturnType<typeof createUserWithToken>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let outsider: Awaited<ReturnType<typeof createUserWithToken>>
let workspaceId: string
let projectId: string

type Who = { headers: Record<string, string> }
const call = (method: string, path: string, who: Who, body?: unknown) =>
  ctx.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...who.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
const json = async (response: Response) => (await response.json()) as any
const make = (who: Who, body: Record<string, unknown> = {}) =>
  call("POST", "/api/recording-requests", who, { workspaceId, projectId, expiresInDays: 7, maxUses: 5, ...body })
const list = (who: Who) => call("GET", `/api/recording-requests?workspaceId=${workspaceId}`, who)

beforeEach(async () => {
  ctx = await setupTestApp({ appUrl: "https://bb.test" })
  workspaceId = ctx.workspace.id
  member = await createUserWithToken(ctx.db, { role: "member", name: "Ana" })
  other = await createUserWithToken(ctx.db, { role: "member", name: "Budi" })
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
  outsider = await createUserWithToken(ctx.db, { workspaceId: elsewhere.id, role: "admin" })
  projectId = (await createProject(ctx.db, { name: "Storefront" })).id
})

describe("making request links", () => {
  test("a member makes a link; its token is shown once and stored as a hash", async () => {
    const response = await make(member, { note: "The checkout bug, please", pageUrl: "https://shop.test/cart" })
    expect(response.status).toBe(200)
    const made = await json(response)
    expect(made.url).toMatch(/^https:\/\/bb\.test\/request\/[A-Za-z0-9_-]{43}$/)
    expect(made.maxUses).toBe(5)
    const [row] = await ctx.db.select().from(recordingRequest)
    const token = made.url.split("/").pop()
    expect(row?.tokenHash).not.toBe(token)
    expect(made.url).not.toContain(row?.tokenHash)
    const listed = await json(await list(member))
    expect(JSON.stringify(listed)).not.toContain(token)
    expect(listed).toMatchObject([
      { id: made.id, projectId, note: "The checkout bug, please", pageUrl: "https://shop.test/cart", createdBy: { id: member.user.id, name: "Ana" }, maxUses: 5, used: 0, status: "live", reports: [] },
    ])
    expect(listed[0].url).toBeUndefined()
  })

  test("the link expires after the days picked", async () => {
    const before = Date.now()
    const made = await json(await make(member, { expiresInDays: 1 }))
    const expires = new Date(made.expiresAt).getTime()
    expect(expires - before).toBeGreaterThanOrEqual(86_400_000 - 1000)
    expect(expires - before).toBeLessThanOrEqual(86_400_000 + 5000)
  })

  test("days and uses outside the offered choices are refused", async () => {
    expect((await make(member, { expiresInDays: 3 })).status).toBe(422)
    expect((await make(member, { maxUses: 1000 })).status).toBe(422)
  })

  test("the list counts uses and lists the reports that came through it", async () => {
    const made = await json(await make(member))
    const sent = await createReadyReport(ctx.db, { reporterId: member.user.id, projectId })
    await ctx.db.execute(sql`UPDATE report SET recording_request_id = ${made.id} WHERE id = ${sent.id}`)
    const failed = await createReadyReport(ctx.db, { reporterId: member.user.id, projectId })
    await ctx.db.execute(sql`UPDATE report SET recording_request_id = ${made.id}, upload_status = 'failed' WHERE id = ${failed.id}`)
    const [row] = await json(await list(member))
    expect(row.used).toBe(1)
    expect(row.reports).toEqual([{ id: sent.id, number: sent.number }])
  })

  test("the 51st live link is refused; expired and revoked ones don't count", async () => {
    for (let i = 0; i < 50; i++) expect((await make(member)).status).toBe(200)
    const over = await make(member)
    expect(over.status).toBe(422)
    expect((await json(over)).code).toBe("request_limit")
    await ctx.db.execute(sql`UPDATE recording_request SET expires_at = now() - interval '1 minute' WHERE id IN (SELECT id FROM recording_request LIMIT 1)`)
    expect((await make(member)).status).toBe(200)
    const [newest] = await json(await list(member))
    expect((await call("DELETE", `/api/recording-requests/${newest.id}`, member)).status).toBe(200)
    expect((await make(member)).status).toBe(200)
  })

  test("two links made at once on the 50th place: one is refused", async () => {
    for (let i = 0; i < 49; i++) expect((await make(member)).status).toBe(200)
    const answers = await Promise.all([make(member), make(member), make(member)])
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 422, 422])
  })

  test("a project of another workspace is refused", async () => {
    const theirs = await createProject(ctx.db, { name: "Theirs", workspaceId: (await createWorkspaceRow(ctx.db, "Other")).id })
    const response = await make(member, { projectId: theirs.id })
    expect(response.status).toBe(422)
    expect((await json(response)).code).toBe("project_not_found")
  })

  test("a link without a project is fine", async () => {
    expect(await json(await make(member, { projectId: null }))).toMatchObject({ maxUses: 5 })
  })

  test("a page address that isn't http or https is refused", async () => {
    expect((await make(member, { pageUrl: "javascript:alert(1)" })).status).toBe(422)
    expect((await make(member, { pageUrl: "not a url" })).status).toBe(422)
  })

  test("its maker revokes it; another member can't; an admin can", async () => {
    const first = await json(await make(member))
    expect((await call("DELETE", `/api/recording-requests/${first.id}`, other)).status).toBe(403)
    expect((await call("DELETE", `/api/recording-requests/${first.id}`, member)).status).toBe(200)
    expect((await json(await list(member)))[0].status).toBe("revoked")
    const second = await json(await make(member))
    expect((await call("DELETE", `/api/recording-requests/${second.id}`, admin)).status).toBe(200)
  })

  test("an outsider gets 404 for the list's workspace and for a link by id", async () => {
    const made = await json(await make(member))
    expect((await list(outsider)).status).toBe(404)
    const response = await call("DELETE", `/api/recording-requests/${made.id}`, outsider)
    expect(response.status).toBe(404)
    expect((await json(response)).code).toBe("request_not_found")
    expect((await make(outsider)).status).toBe(404)
  })
})

describe("a link's status", () => {
  const now = new Date("2026-11-16T12:00:00Z")
  const live = { expiresAt: new Date("2026-11-20T00:00:00Z"), revokedAt: null, maxUses: 5 }

  test("revoked beats expired beats used up", () => {
    expect(requestStatus(live, 0, now)).toBe("live")
    expect(requestStatus(live, 5, now)).toBe("used_up")
    expect(requestStatus({ ...live, expiresAt: now }, 5, now)).toBe("expired")
    expect(requestStatus({ ...live, expiresAt: now, revokedAt: now }, 5, now)).toBe("revoked")
  })

  test("the link's address", () => {
    expect(requestUrl("https://bb.test", "abc")).toBe("https://bb.test/request/abc")
  })
})
