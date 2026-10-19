import { beforeEach, describe, expect, test } from "bun:test"
import { LocalStorageDriver } from "../src/storage/local"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  member = await createUserWithToken(ctx.db, { email: "ana@kantor.test", name: "Ana" })
  projectId = (await createProject(ctx.db)).id
})

const anonymous = (slug: string, ip = "203.0.113.7") =>
  ctx.api.api.share({ slug }).get({ headers: { "x-forwarded-for": ip } })

describe("GET /api/share/:slug", () => {
  test("public reports open without login and hide the reporter's email", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public" })
    const { data } = await anonymous(created.shareSlug)
    expect(data?.id).toBe(created.id)
    expect(data?.mediaUrl).toContain("/api/files/")
    expect(JSON.stringify(data)).not.toContain("ana@kantor.test")
  })

  test("internal reports need a member login", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    expect((await anonymous(created.shareSlug)).error?.status as number | undefined).toBe(401)
    const { data } = await ctx.api.api.share({ slug: created.shareSlug }).get({ headers: member.headers })
    expect(data?.id).toBe(created.id)
  })

  test("making a public report internal again closes anonymous access", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public" })
    expect((await anonymous(created.shareSlug)).error).toBeNull()
    const { data } = await ctx.api.api.reports({ id: created.id }).patch({ visibility: "internal" }, { headers: member.headers })
    // The public link is retired; the new one needs a login.
    expect((await anonymous(created.shareSlug)).error?.status as number | undefined).toBe(404)
    expect((await anonymous(data?.shareSlug ?? "")).error?.status as number | undefined).toBe(401)
  })

  test("anonymous viewers get media links that expire within 5 minutes; members keep the normal duration", async () => {
    if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
    const local = ctx.storage
    const minutesLeft = (url: string | null | undefined) => {
      const claims = local.verifyReadToken(url?.split("/api/files/")[1] ?? "")
      return claims ? (claims.exp - Date.now()) / 60_000 : null
    }
    const created = await createReadyReport(ctx.db, {
      projectId,
      reporterId: member.user.id,
      visibility: "public",
      debuggerKey: "reports/x/debugger.json.gz",
    })

    const { data: shared } = await anonymous(created.shareSlug)
    // Turning a report internal cannot revoke a presigned URL, so anonymous ones are kept short.
    for (const url of [shared?.mediaUrl, shared?.debuggerUrl]) {
      const left = minutesLeft(url)
      expect(left).not.toBeNull()
      expect(left as number).toBeLessThanOrEqual(5)
    }

    const { data: forMember } = await ctx.api.api.share({ slug: created.shareSlug }).get({ headers: member.headers })
    expect(minutesLeft(forMember?.mediaUrl) as number).toBeGreaterThan(55)
  })

  test("regenerating the link retires the old slug", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public" })
    const { data } = await ctx.api.api.reports({ id: created.id }).share.regenerate.post(undefined, { headers: member.headers })
    expect(data?.shareSlug).not.toBe(created.shareSlug)
    expect(data?.shareUrl).toBe(`http://localhost:3000/s/${data?.shareSlug}`)
    expect((await anonymous(created.shareSlug)).error?.status as number | undefined).toBe(404)
    expect((await anonymous(data?.shareSlug ?? "")).error).toBeNull()
  })

  test("unknown slugs and unfinished uploads return 404", async () => {
    const uploading = await createReadyReport(ctx.db, {
      projectId,
      reporterId: member.user.id,
      visibility: "public",
      uploadStatus: "uploading",
    })
    expect((await anonymous("doesNotExist")).error?.status as number | undefined).toBe(404)
    expect((await anonymous(uploading.shareSlug)).error?.status as number | undefined).toBe(404)
  })

  test("limits anonymous viewers to 60 requests per minute per IP behind a trusted proxy", async () => {
    ctx = await setupTestApp({ proxyHops: 1 })
    member = await createUserWithToken(ctx.db, { email: "ana@kantor.test", name: "Ana" })
    projectId = (await createProject(ctx.db)).id
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public" })
    for (let i = 0; i < 60; i++) await anonymous(created.shareSlug, "198.51.100.1")
    expect((await anonymous(created.shareSlug, "198.51.100.1")).error?.status as number | undefined).toBe(429)
    expect((await anonymous(created.shareSlug, "198.51.100.2")).error).toBeNull()
  })

  test("uses the proxy-appended (right-most) forwarded address, not one the client wrote", async () => {
    ctx = await setupTestApp({ proxyHops: 1 })
    member = await createUserWithToken(ctx.db)
    projectId = (await createProject(ctx.db)).id
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public" })
    for (let i = 0; i < 60; i++) await anonymous(created.shareSlug, `10.0.0.${i}, 198.51.100.9`)
    expect((await anonymous(created.shareSlug, "10.9.9.9, 198.51.100.9")).error?.status as number | undefined).toBe(429)
  })

  test("behind nginx and Caddy (2 hops) uses the address Caddy appended, whatever the client wrote", async () => {
    ctx = await setupTestApp({ proxyHops: 2 })
    member = await createUserWithToken(ctx.db)
    projectId = (await createProject(ctx.db)).id
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public" })
    for (let i = 0; i < 60; i++) await anonymous(created.shareSlug, `10.0.0.${i}, 198.51.100.9, 172.18.0.5`)
    expect((await anonymous(created.shareSlug, "10.9.9.9, 198.51.100.9, 172.18.0.7")).error?.status as number | undefined).toBe(429)
    expect((await anonymous(created.shareSlug, "10.9.9.9, 198.51.100.10, 172.18.0.5")).error).toBeNull()
  })

  test("with fewer forwarded entries than hops, the left-most entry is the client", async () => {
    ctx = await setupTestApp({ proxyHops: 2 })
    member = await createUserWithToken(ctx.db)
    projectId = (await createProject(ctx.db)).id
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public" })
    for (let i = 0; i < 60; i++) await anonymous(created.shareSlug, "198.51.100.7")
    expect((await anonymous(created.shareSlug, "198.51.100.7")).error?.status as number | undefined).toBe(429)
    expect((await anonymous(created.shareSlug, "198.51.100.8")).error).toBeNull()
  })

  test("ignores X-Forwarded-For entirely when no proxy is trusted", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, visibility: "public" })
    for (let i = 0; i < 60; i++) await anonymous(created.shareSlug, `10.0.1.${i}`)
    expect((await anonymous(created.shareSlug, "10.0.2.1")).error?.status as number | undefined).toBe(429)
  })
})
