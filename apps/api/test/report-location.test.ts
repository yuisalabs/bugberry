import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import { createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const JAKARTA = { latitude: -6.21, longitude: 106.85 }
const status = (result: { error: { status: unknown } | null }) => result.error?.status as number | undefined

describe("POST /api/reports/:id/location", () => {
  test("the reporter sets the city and members see it", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const colleague = await createUserWithToken(ctx.db)
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id })
    const { data } = await ctx.api.api.reports({ id: target.id }).location.post(JAKARTA, { headers: reporter.headers })
    expect(data).toEqual({ location: "Jakarta, Indonesia" })
    const { data: detail } = await ctx.api.api.reports({ id: target.id }).get({ headers: colleague.headers })
    expect(detail?.location).toBe("Jakarta, Indonesia")
  })

  test("share viewers never get the city", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id, visibility: "public" })
    await ctx.api.api.reports({ id: target.id }).location.post(JAKARTA, { headers: reporter.headers })
    const shared = await ctx.api.api.share({ slug: target.shareSlug }).get()
    expect(shared.data?.id).toBe(target.id)
    expect(JSON.stringify(shared.data)).not.toContain("Jakarta")
  })

  test("a teammate cannot set someone else's location, and an outsider gets 404", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const colleague = await createUserWithToken(ctx.db)
    const other = await createWorkspaceRow(ctx.db, "Other")
    const outsider = await createUserWithToken(ctx.db, { workspaceId: other.id })
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id })
    const location = ctx.api.api.reports({ id: target.id }).location
    expect(status(await location.post(JAKARTA, { headers: colleague.headers }))).toBe(403)
    expect(status(await location.post(JAKARTA, { headers: outsider.headers }))).toBe(404)
  })

  test("coordinates out of range are refused", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id })
    const location = ctx.api.api.reports({ id: target.id }).location
    expect(status(await location.post({ latitude: 91, longitude: 0 }, { headers: reporter.headers }))).toBeOneOf([400, 422])
    expect(status(await location.post({ latitude: 0, longitude: -181 }, { headers: reporter.headers }))).toBeOneOf([400, 422])
  })

  test("the response and the report row hold no coordinates", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id })
    const result = await ctx.api.api.reports({ id: target.id }).location.post(JAKARTA, { headers: reporter.headers })
    expect(JSON.stringify(result.data)).not.toContain("106")
    const [row] = await ctx.db.select().from(report).where(eq(report.id, target.id))
    expect(row?.location).toBe("Jakarta, Indonesia")
    expect(JSON.stringify(row)).not.toContain("106.85")
  })

  test("the sea gives no city and clears nothing else", async () => {
    const reporter = await createUserWithToken(ctx.db)
    const target = await createReadyReport(ctx.db, { reporterId: reporter.user.id })
    const { data } = await ctx.api.api.reports({ id: target.id }).location.post({ latitude: 0, longitude: -140 }, { headers: reporter.headers })
    expect(data).toEqual({ location: null })
  })
})
