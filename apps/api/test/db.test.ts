import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { Db } from "../src/db/client"
import { comment, integration, project, report, reportExternalLink, user, workspace } from "../src/db/schema"
import { newId, newShareSlug } from "../src/lib/ids"
import { getTestDb, resetDb } from "./helpers"

let db: Db

beforeEach(async () => {
  db = await getTestDb()
  await resetDb(db)
})

async function seed() {
  const userId = newId()
  const projectId = newId()
  await db.insert(user).values({ id: userId, name: "Ana", email: "ana@kantor.test" })
  const workspaceId = newId()
  await db.insert(workspace).values({ id: workspaceId, name: "Test" })
  await db.insert(project).values({ id: projectId, workspaceId, name: "Web", slug: "web" })
  const reportValues = {
    id: newId(),
    workspaceId,
    number: 1,
    projectId,
    reporterId: userId,
    title: "Broken",
    shareSlug: newShareSlug(),
    captureType: "screenshot" as const,
    pageUrl: "https://app.kantor.test",
    device: { browser: "Chrome", os: "Windows", viewport: "1440x900" },
    mediaKey: "reports/x/media.png",
    mediaType: "image/png",
    mediaSize: 10,
    debuggerSummary: { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] },
  }
  return { userId, projectId, reportValues }
}

describe("schema", () => {
  test("report defaults", async () => {
    const { reportValues } = await seed()
    await db.insert(report).values(reportValues)
    const [row] = await db.select().from(report).where(eq(report.id, reportValues.id))
    expect(row).toMatchObject({
      status: "open",
      priority: "none",
      visibility: "workspace",
      uploadStatus: "uploading",
      description: "",
      device: { browser: "Chrome", os: "Windows", viewport: "1440x900" },
    })
  })

  test("project url patterns default to an empty array", async () => {
    const { projectId } = await seed()
    const [row] = await db.select().from(project).where(eq(project.id, projectId))
    expect(row?.urlPatterns).toEqual([])
  })

  test("rejects an unknown status", async () => {
    const { reportValues } = await seed()
    await expect(db.insert(report).values({ ...reportValues, status: "bogus" as never }).execute()).rejects.toThrow()
  })

  test("a project with reports cannot be deleted", async () => {
    const { projectId, reportValues } = await seed()
    await db.insert(report).values(reportValues)
    await expect(db.delete(project).where(eq(project.id, projectId)).execute()).rejects.toThrow()
  })
})

describe("comments and tracker links", () => {
  test("a report keeps one link per integration and takes its comments and links when deleted", async () => {
    const { userId, projectId, reportValues } = await seed()
    await db.insert(report).values(reportValues)
    const integrationId = newId()
    await db.insert(integration).values({
      id: integrationId,
      projectId,
      provider: "github",
      config: { owner: "kantor", repo: "web", labels: [] },
      secretEncrypted: "v1.a.b.c",
    })
    await db.insert(comment).values({ id: newId(), reportId: reportValues.id, authorId: userId, body: "Check this first" })
    await db.insert(reportExternalLink).values({ id: newId(), reportId: reportValues.id, integrationId })
    await expect(
      db.insert(reportExternalLink).values({ id: newId(), reportId: reportValues.id, integrationId }).execute(),
    ).rejects.toThrow()

    await db.delete(report).where(eq(report.id, reportValues.id))
    expect(await db.select().from(comment)).toEqual([])
    expect(await db.select().from(reportExternalLink)).toEqual([])
  })
})
