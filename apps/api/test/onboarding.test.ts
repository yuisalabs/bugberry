import { beforeEach, describe, expect, test } from "bun:test"
import { ONBOARDING_STEPS } from "@bugberry/shared"
import { eq } from "drizzle-orm"
import { apiToken, comment, type OnboardingState, report, user } from "../src/db/schema"
import { hashToken } from "../src/lib/api-token"
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
    expect((await progress()).data?.trackerTarget).toBeNull()
    const inProject = await createReadyReport(ctx.db, { reporterId: budi.user.id, projectId: web.id })
    await createReadyReport(ctx.db, { reporterId: budi.user.id, projectId: null })
    expect((await progress()).data?.trackerTarget).toBe(inProject.id)
  })

  test("reportTarget prefers my own report, else a teammate's", async () => {
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

  test("an outsider workspace answers 404", async () => {
    const elsewhere = await createWorkspaceRow(ctx.db, "Elsewhere")
    const { error } = await progress(budi, elsewhere.id)
    expect(error?.status as number | undefined).toBe(404)
  })
})
