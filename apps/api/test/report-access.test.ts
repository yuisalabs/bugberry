import { beforeEach, describe, expect, test } from "bun:test"
import type { Visibility } from "@bugberry/shared"
import { reportAccess } from "../src/workspaces/report-access"
import { createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

const report = (visibility: Visibility, reporterDomain: string | null = "ptmaju.com") => ({
  workspaceId: "w1",
  visibility,
  reporterDomain,
})
const member = { email: "budi@ptmaju.com", isMember: true }
const colleague = { email: "sari@ptmaju.com", isMember: false }
const stranger = { email: "eve@other.com", isMember: false }

describe("reportAccess", () => {
  test.each([
    ["workspace", member, "member"],
    ["internal", member, "member"],
    ["public", member, "member"],
    ["workspace", null, null],
    ["internal", null, null],
    ["public", null, "viewer"],
    ["internal", colleague, "viewer"],
    ["workspace", colleague, null],
    ["internal", stranger, null],
    ["public", stranger, "viewer"],
  ] as const)("%s report, viewer %o → %p", (visibility, viewer, expected) => {
    expect(reportAccess(report(visibility), viewer)).toBe(expected)
  })

  test("free email domains never share internally, even with each other", () => {
    expect(reportAccess(report("internal", "gmail.com"), { email: "ana@gmail.com", isMember: false })).toBeNull()
    expect(reportAccess(report("internal", null), { email: "ana@ptmaju.com", isMember: false })).toBeNull()
  })

  test("domains compare without case", () => {
    expect(reportAccess(report("internal"), { email: "Sari@PTMaju.com", isMember: false })).toBe("viewer")
  })
})

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp({ allowedEmailDomains: ["kantor.test", "other.test"] })
})

describe("share links and the report page", () => {
  test("a same-domain non-member opens an internal report read-only", async () => {
    const reporter = await createUserWithToken(ctx.db, { email: "budi@kantor.test" })
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const sari = await createUserWithToken(ctx.db, { email: "sari@kantor.test", workspaceId: elsewhere.id })
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "internal" })
    const { data } = await ctx.api.api.share({ slug: target.shareSlug }).get({ headers: sari.headers })
    expect(data?.id).toBe(target.id)
    // Read-only: the report itself stays out of reach.
    expect((await ctx.api.api.reports({ id: target.id }).patch({ title: "x" }, { headers: sari.headers })).error?.status as number | undefined).toBe(404)
  })

  test("a workspace report answers 404 to a signed-in outsider and 401 to nobody", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const sari = await createUserWithToken(ctx.db, { email: "sari@kantor.test", workspaceId: elsewhere.id })
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "workspace" })
    expect((await ctx.api.api.share({ slug: target.shareSlug }).get({ headers: sari.headers })).error?.status as number | undefined).toBe(404)
    expect((await ctx.api.api.share({ slug: target.shareSlug }).get()).error?.status as number | undefined).toBe(401)
  })

  test("an internal report answers 404 to someone at another domain", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const eve = await createUserWithToken(ctx.db, { email: "eve@other.test", workspaceId: elsewhere.id })
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "internal" })
    expect((await ctx.api.api.share({ slug: target.shareSlug }).get({ headers: eve.headers })).error?.status as number | undefined).toBe(404)
  })

  test("the report route points a viewer to the share link", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const sari = await createUserWithToken(ctx.db, { email: "sari@kantor.test", workspaceId: elsewhere.id })
    const eve = await createUserWithToken(ctx.db, { email: "eve@other.test", workspaceId: elsewhere.id })
    const internal = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "internal" })
    const viewer = await ctx.api.api.reports({ id: internal.id }).get({ headers: sari.headers })
    expect(viewer.error?.status as number | undefined).toBe(403)
    expect(viewer.error?.value).toMatchObject({ code: "use_share_link", shareSlug: internal.shareSlug })
    expect((await ctx.api.api.reports({ id: internal.id }).get({ headers: eve.headers })).error?.status as number | undefined).toBe(404)
  })

  test("making a public report private retires its link", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const eve = await createUserWithToken(ctx.db, { email: "eve@other.test", workspaceId: elsewhere.id })
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "public" })
    const { data } = await ctx.api.api.reports({ id: target.id }).patch({ visibility: "workspace" }, { headers: reporter.headers })
    expect(data?.shareSlug).not.toBe(target.shareSlug)
    expect((await ctx.api.api.share({ slug: target.shareSlug }).get({ headers: eve.headers })).error?.status as number | undefined).toBe(404)
  })

  test("workspace to internal keeps the link", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "workspace" })
    const { data } = await ctx.api.api.reports({ id: target.id }).patch({ visibility: "internal" }, { headers: reporter.headers })
    expect(data?.shareSlug).toBe(target.shareSlug)
  })

  test("only the reporter or an admin can reset the link", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const colleague = await createUserWithToken(ctx.db)
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "public" })
    const share = ctx.api.api.reports({ id: target.id }).share.regenerate
    const refused = await share.post(undefined, { headers: colleague.headers })
    expect(refused.error?.status as number | undefined).toBe(403)
    expect((refused.error?.value as { code?: string } | undefined)?.code).toBe("forbidden")
    expect((await share.post(undefined, { headers: reporter.headers })).data?.shareSlug).toBeString()
    expect((await share.post(undefined, { headers: admin.headers })).data?.shareSlug).toBeString()
  })

  test("the share route tells a member they are one", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "public" })
    const forMember = await ctx.api.api.share({ slug: target.shareSlug }).get({ headers: reporter.headers })
    expect(forMember.data?.viewerIsMember).toBe(true)
    const forAnyone = await ctx.api.api.share({ slug: target.shareSlug }).get()
    expect(forAnyone.data?.viewerIsMember).toBe(false)
  })

  test("members see the reporter's email; share viewers do not", async () => {
    const reporter = await createUserWithToken(ctx.db, { email: "budi@kantor.test" })
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "public" })
    const { data } = await ctx.api.api.reports({ id: target.id }).get({ headers: reporter.headers })
    expect(data?.reporterEmail).toBe("budi@kantor.test")
    const shared = await ctx.api.api.share({ slug: target.shareSlug }).get({ headers: reporter.headers })
    expect(JSON.stringify(shared.data)).not.toContain("budi@kantor.test")
  })
})
