import { beforeEach, describe, expect, test } from "bun:test"
import { ONBOARDING_STEPS } from "@bugberry/shared"
import { eq, sql } from "drizzle-orm"
import { apiToken, comment, type OnboardingState, report, user } from "../src/db/schema"
import { hashToken } from "../src/modules/tokens/token"
import { newId } from "../src/lib/ids"
import { createIntegration, createProject, createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  ctx = await setupTestApp()
  budi = await createUserWithToken(ctx.db, { name: "Budi", role: "admin" })
  await setOnboarding(budi.user.id, {})
})

async function setOnboarding(userId: string, state: OnboardingState | null) {
  await ctx.db.update(user).set({ onboarding: state }).where(eq(user.id, userId))
}

const onboardingOf = async (userId: string) =>
  (await ctx.db.select({ onboarding: user.onboarding }).from(user).where(eq(user.id, userId)))[0]?.onboarding

const progress = async (person = budi, workspaceId = ctx.workspace.id) => {
  const { data, error } = await ctx.api.api.me.onboarding.get({ query: { workspaceId }, headers: person.headers })
  return { data: data?.progress, error }
}

const ids = async (person = budi) => (await progress(person)).data?.steps.map((step) => step.id)
const done = async (id: string, person = budi) => (await progress(person)).data?.steps.find((step) => step.id === id)?.done

const ALL_STEPS = Object.fromEntries(ONBOARDING_STEPS.map((id) => [id, "2026-10-25T00:00:00.000Z"]))
const BONUS: OnboardingState = { steps: ALL_STEPS, celebratedAt: "2026-10-25T00:00:00.000Z" }

describe("GET /me/onboarding", () => {
  test("no checklist for accounts without onboarding", async () => {
    await setOnboarding(budi.user.id, null)
    const { data, error } = await progress()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  test("a fresh account sees the five steps, none done", async () => {
    const { data } = await progress()
    expect(data?.phase).toBe("required")
    expect(data?.steps.map((step) => step.id)).toEqual([...ONBOARDING_STEPS])
    expect(data?.steps.every((step) => !step.done)).toBe(true)
    expect(data?.reportTarget).toBeNull()
    expect(data?.collapsed).toBe(false)
  })

  test("steps tick in any order", async () => {
    await createReadyReport(ctx.db, { reporterId: budi.user.id, captureType: "video" })
    expect(await done("extension")).toBe(true)
    expect(await done("video")).toBe(true)
    expect(await done("screenshot")).toBe(false)
  })

  test("only ready uploads count", async () => {
    await createReadyReport(ctx.db, { reporterId: budi.user.id, uploadStatus: "failed" })
    await createReadyReport(ctx.db, { reporterId: budi.user.id, uploadStatus: "uploading" })
    expect(await done("screenshot")).toBe(false)
    expect(await done("extension")).toBe(true)
  })

  test("a deleted report never unticks a step", async () => {
    const row = await createReadyReport(ctx.db, { reporterId: budi.user.id })
    expect(await done("screenshot")).toBe(true)
    await ctx.db.delete(report).where(eq(report.id, row.id))
    expect(await done("screenshot")).toBe(true)
  })

  test("celebrate, then bonus", async () => {
    await setOnboarding(budi.user.id, { steps: ALL_STEPS })
    expect((await progress()).data?.phase).toBe("celebrate")
    await setOnboarding(budi.user.id, BONUS)
    const { data } = await progress()
    expect(data?.phase).toBe("bonus")
    expect(data?.steps.map((step) => step.id)).toEqual(["invite", "project", "comment", "tracker", "agent"])
  })

  test("a member sees only member missions", async () => {
    const sari = await createUserWithToken(ctx.db, { name: "Sari", role: "member" })
    await setOnboarding(sari.user.id, BONUS)
    expect(await ids(sari)).toEqual(["comment", "agent"])
  })

  test("notifiers are not trackers, and send needs a project tracker", async () => {
    await setOnboarding(budi.user.id, BONUS)
    const web = await createProject(ctx.db)
    await createIntegration(ctx.db, { projectId: web.id, provider: "slack" })
    expect(await done("tracker")).toBe(false)
    expect(await ids()).not.toContain("send")
    await createIntegration(ctx.db, { projectId: web.id, provider: "github" })
    expect(await done("tracker")).toBe(true)
    expect(await ids()).toContain("send")
    expect(await done("send")).toBe(false)
    // Send is next once the missions before it are done; only then is its report looked up.
    const before = { invite: "2026-10-25T00:00:00.000Z", project: "2026-10-25T00:00:00.000Z", comment: "2026-10-25T00:00:00.000Z" }
    await setOnboarding(budi.user.id, { ...BONUS, steps: { ...ALL_STEPS, ...before, tracker: "2026-10-25T00:00:00.000Z" } })
    expect((await progress()).data?.trackerTarget).toBeNull()
    const inProject = await createReadyReport(ctx.db, { reporterId: budi.user.id, projectId: web.id })
    await createReadyReport(ctx.db, { reporterId: budi.user.id, projectId: null })
    expect((await progress()).data?.trackerTarget).toBe(inProject.id)
  })

  test("reportTarget prefers my own report, else a teammate's", async () => {
    await setOnboarding(budi.user.id, { steps: { extension: "2026-10-25T00:00:00.000Z", screenshot: "2026-10-25T00:00:00.000Z", video: "2026-10-25T00:00:00.000Z" } })
    const sari = await createUserWithToken(ctx.db, { name: "Sari" })
    const theirs = await createReadyReport(ctx.db, { reporterId: sari.user.id, createdAt: new Date("2026-10-25T10:00:00Z") })
    expect((await progress()).data?.reportTarget).toBe(theirs.id)
    const mine = await createReadyReport(ctx.db, { reporterId: budi.user.id, createdAt: new Date("2026-10-25T09:00:00Z") })
    expect((await progress()).data?.reportTarget).toBe(mine.id)
  })

  test("all missions done completes the checklist for good", async () => {
    const sari = await createUserWithToken(ctx.db, { name: "Sari", role: "member" })
    await setOnboarding(sari.user.id, BONUS)
    const row = await createReadyReport(ctx.db, { reporterId: budi.user.id })
    await ctx.db.insert(comment).values({ id: newId(), reportId: row.id, authorId: sari.user.id, body: "Seen it" })
    await ctx.db.insert(apiToken).values({ id: newId(), userId: sari.user.id, tokenHash: hashToken(newId()), label: "Claude", kind: "mcp" })
    expect((await progress(sari)).data).toBeNull()
    expect((await onboardingOf(sari.user.id))?.completedAt).toBeTruthy()
    expect((await progress(sari)).data).toBeNull()
  })

  test("targets are only looked up for the step that needs them", async () => {
    const sari = await createUserWithToken(ctx.db, { name: "Sari" })
    await createReadyReport(ctx.db, { reporterId: sari.user.id })
    const { data } = await progress()
    expect(data?.steps.find((step) => !step.done)?.id).toBe("extension")
    expect(data?.reportTarget).toBeNull()
    expect(data?.trackerTarget).toBeNull()
  })

  test("the columns progress is read by are indexed", async () => {
    const rows = await ctx.db.execute<{ tablename: string; indexdef: string }>(
      sql`select tablename, indexdef from pg_indexes where schemaname = 'public'`,
    )
    const indexed = (table: string, column: string) =>
      [...rows].some((row) => row.tablename === table && new RegExp(`\\(${column}[,)]`).test(row.indexdef))
    expect(indexed("report", "reporter_id")).toBe(true)
    expect(indexed("comment", "author_id")).toBe(true)
    expect(indexed("report_activity", "actor_id")).toBe(true)
    expect(indexed("workspace_invitation", "invited_by_id")).toBe(true)
  })

  test("an outsider workspace answers 404", async () => {
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const { error } = await progress(budi, elsewhere.id)
    expect(error?.status as number | undefined).toBe(404)
  })
})

describe("POST /me/onboarding", () => {
  const record = (body: { event: "extension" | "devtools" | "shared" | "celebrated" } | { collapsed: boolean }, person = budi) =>
    ctx.api.api.me.onboarding.post(body, { headers: person.headers })

  test("events tick client-only steps once", async () => {
    await record({ event: "devtools" })
    const first = (await onboardingOf(budi.user.id))?.steps?.devtools
    expect(first).toBeTruthy()
    await Bun.sleep(5)
    await record({ event: "devtools" })
    expect((await onboardingOf(budi.user.id))?.steps?.devtools).toBe(first)
    expect(await done("devtools")).toBe(true)
  })

  test("collapse is remembered", async () => {
    await record({ collapsed: true })
    expect((await progress()).data?.collapsed).toBe(true)
    await record({ collapsed: false })
    expect((await progress()).data?.collapsed).toBe(false)
  })

  test("celebrating before the five are done does nothing", async () => {
    await setOnboarding(budi.user.id, { steps: { extension: "2026-10-25T00:00:00.000Z", screenshot: "2026-10-25T00:00:00.000Z" } })
    await record({ event: "celebrated" })
    expect((await progress()).data?.phase).toBe("required")
    expect((await onboardingOf(budi.user.id))?.celebratedAt).toBeUndefined()
  })

  test("celebrating after the five moves on to the bonus missions", async () => {
    await setOnboarding(budi.user.id, { steps: ALL_STEPS })
    await record({ event: "celebrated" })
    expect((await progress()).data?.phase).toBe("bonus")
  })

  test("events do nothing for accounts without onboarding", async () => {
    await setOnboarding(budi.user.id, null)
    await record({ event: "shared" })
    expect(await onboardingOf(budi.user.id)).toBeNull()
  })

  test("a progress check at the same moment never loses an event", async () => {
    for (let round = 0; round < 8; round++) {
      await ctx.db.delete(report)
      await setOnboarding(budi.user.id, { steps: ALL_STEPS })
      // The check finds a fresh mission tick and writes it while the celebration is being recorded.
      await createReadyReport(ctx.db, { reporterId: budi.user.id })
      await Promise.all([progress(), record({ event: "celebrated" }), progress(), record({ collapsed: true })])
      const state = await onboardingOf(budi.user.id)
      expect(state?.celebratedAt).toBeTruthy()
      expect(state?.collapsed).toBe(true)
    }
    for (let round = 0; round < 8; round++) {
      await ctx.db.delete(comment)
      await setOnboarding(budi.user.id, BONUS)
      const row = await createReadyReport(ctx.db, { reporterId: budi.user.id })
      await ctx.db.insert(comment).values({ id: newId(), reportId: row.id, authorId: budi.user.id, body: "Seen it" })
      await Promise.all([progress(), record({ collapsed: true }), progress()])
      const state = await onboardingOf(budi.user.id)
      expect(state?.steps?.comment).toBeTruthy()
      expect(state?.collapsed).toBe(true)
    }
  })

  test("an unknown event is refused", async () => {
    const { error } = await ctx.api.api.me.onboarding.post({ event: "nope" } as never, { headers: budi.headers })
    expect(error?.status as number | undefined).toBe(422)
  })
})
