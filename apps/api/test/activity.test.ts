import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { reportActivity } from "../src/db/schema"
import { recordActivity, recordAgentRead } from "../src/modules/activity/service"
import { createProject, createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let ana: Awaited<ReturnType<typeof createUserWithToken>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>
let reportId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  ana = await createUserWithToken(ctx.db, { name: "Ana" })
  budi = await createUserWithToken(ctx.db, { name: "Budi" })
  const project = await createProject(ctx.db)
  reportId = (
    await createReadyReport(ctx.db, {
      projectId: project.id,
      reporterId: ana.user.id,
      device: { browser: "Firefox 131", os: "Windows 11", viewport: "1440x900" },
    })
  ).id
})

const activity = (who = ana) => ctx.api.api.reports({ id: reportId }).activity.get({ headers: who.headers })

describe("report activity", () => {
  test("lists recorded activity newest first, ending with created", async () => {
    await recordActivity(ctx.db, { reportId, kind: "priority", detail: { from: "none", to: "high" }, actorId: ana.user.id, viaAgent: null })
    await Bun.sleep(10)
    await recordActivity(ctx.db, { reportId, kind: "status", detail: { from: "open", to: "in_progress" }, actorId: budi.user.id, viaAgent: "Claude Code" })
    const { data } = await activity()
    expect(data?.map((item) => item.kind)).toEqual(["status", "priority", "created"])
    expect(data?.[0]).toMatchObject({ actor: { id: budi.user.id, name: "Budi" }, viaAgent: "Claude Code", detail: { from: "open", to: "in_progress" } })
    expect(data?.[2]).toMatchObject({ kind: "created", actor: { id: ana.user.id, name: "Ana" }, viaAgent: null, detail: { browser: "Firefox 131" } })
  })

  test("agent reads merge per person and agent within an hour", async () => {
    const t0 = new Date("2026-10-21T08:00:00Z")
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000)
    await recordAgentRead(ctx.db, { reportId, actorId: ana.user.id, viaAgent: "Claude Code", part: "report", now: t0 })
    await recordAgentRead(ctx.db, { reportId, actorId: ana.user.id, viaAgent: "Claude Code", part: "network", now: at(10) })
    await recordAgentRead(ctx.db, { reportId, actorId: ana.user.id, viaAgent: "Claude Code", part: "report", now: at(20) })
    await recordAgentRead(ctx.db, { reportId, actorId: budi.user.id, viaAgent: "Claude Code", part: "report", now: at(5) })
    await recordAgentRead(ctx.db, { reportId, actorId: ana.user.id, viaAgent: "Claude Code", part: "console", now: at(61) })
    const rows = await ctx.db.select().from(reportActivity).where(eq(reportActivity.reportId, reportId))
    const reads = rows.map((row) => [row.actorId, (row.detail as { parts: string[] }).parts]).sort((a, b) => String(a).localeCompare(String(b)))
    expect(reads).toHaveLength(3)
    expect(reads).toContainEqual([ana.user.id, ["report", "network"]])
    expect(reads).toContainEqual([ana.user.id, ["console"]])
    expect(reads).toContainEqual([budi.user.id, ["report"]])
    const merged = rows.find((row) => (row.detail as { parts: string[] }).parts.length === 2)
    expect(merged?.updatedAt.toISOString()).toBe(at(20).toISOString())
  })

  test("a merged read shows at its latest time", async () => {
    const old = new Date(Date.now() - 30 * 60_000)
    await recordAgentRead(ctx.db, { reportId, actorId: ana.user.id, viaAgent: "Claude Code", part: "report", now: old })
    await recordAgentRead(ctx.db, { reportId, actorId: ana.user.id, viaAgent: "Claude Code", part: "console" })
    const { data } = await activity()
    const read = data?.find((item) => item.kind === "agent_read")
    expect(read?.detail).toEqual({ parts: ["report", "console"] })
    expect(new Date(read?.at ?? 0).getTime()).toBeGreaterThan(old.getTime() + 25 * 60_000)
  })

  test("assignee ids resolve to people", async () => {
    await recordActivity(ctx.db, { reportId, kind: "assignee", detail: { from: null, to: budi.user.id }, actorId: ana.user.id, viaAgent: null })
    const { data } = await activity()
    expect(data?.[0]?.detail).toEqual({ from: null, to: { id: budi.user.id, name: "Budi", image: null } })
  })

  test("outsiders get 404", async () => {
    const elsewhere = await createWorkspaceRow(ctx.db, "Other")
    const outsider = await createUserWithToken(ctx.db, { name: "Out", workspaceId: elsewhere.id })
    const { error } = await activity(outsider)
    expect(error?.status as number | undefined).toBe(404)
  })
})
