import { beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { integration, reportActivity, reportExternalLink } from "../src/db/schema"
import { createSecretBox } from "../src/lib/secret-box"
import { newId } from "../src/lib/ids"
import { BACKFILL_TRACKER_ACTIVITY, backfillTrackerActivity } from "../src/modules/activity/backfill"
import { createProject, createReadyReport, createUserWithToken, setupTestApp, TEST_ENCRYPTION_KEY } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

test("migration 0020 ends with the same backfill statement", async () => {
  const migration = await Bun.file(new URL("../drizzle/0020_comments_v2.sql", import.meta.url)).text()
  expect(migration.trimEnd().endsWith(BACKFILL_TRACKER_ACTIVITY)).toBe(true)
})

test("earlier tracker sends become activity, failed ones do not", async () => {
  const ana = await createUserWithToken(ctx.db, { name: "Ana" })
  const project = await createProject(ctx.db)
  const report = await createReadyReport(ctx.db, { projectId: project.id, reporterId: ana.user.id })
  const sealed = createSecretBox(TEST_ENCRYPTION_KEY).seal("ghp_secret")
  const github = newId()
  const failing = newId()
  await ctx.db.insert(integration).values([
    { id: github, projectId: project.id, provider: "github", config: { owner: "a", repo: "b", labels: [] }, secretEncrypted: sealed },
    { id: failing, projectId: project.id, provider: "github", config: { owner: "a", repo: "c", labels: [] }, secretEncrypted: sealed },
  ])
  const sentAt = new Date("2026-10-01T10:00:00Z")
  await ctx.db.insert(reportExternalLink).values([
    {
      id: newId(),
      reportId: report.id,
      integrationId: github,
      externalId: "142",
      externalUrl: "https://github.com/a/b/issues/142",
      createdAt: sentAt,
    },
    { id: newId(), reportId: report.id, integrationId: failing, externalId: null, error: "boom" },
  ])

  await backfillTrackerActivity(ctx.db)

  const rows = await ctx.db.select().from(reportActivity).where(eq(reportActivity.reportId, report.id))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    kind: "tracker",
    actorId: null,
    viaAgent: null,
    detail: { provider: "github", externalId: "142", externalUrl: "https://github.com/a/b/issues/142" },
  })
  expect(rows[0]?.createdAt.toISOString()).toBe(sentAt.toISOString())
})
