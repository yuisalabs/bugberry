import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { CurrentUser } from "../src/auth/plugin"
import { report } from "../src/db/schema"
import { createReportUpload, uploadTargetsFor } from "../src/modules/reports/upload-flow"
import { createProject, createUserWithToken, setupTestApp, uploadBody } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let reporter: CurrentUser
let projectId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  const { user } = await createUserWithToken(ctx.db)
  reporter = { id: user.id, email: user.email, name: user.name, image: user.image ?? null, lastWorkspaceId: user.lastWorkspaceId ?? null }
  projectId = (await createProject(ctx.db)).id
})

async function rowOf(id: string) {
  const [row] = await ctx.db.select().from(report).where(eq(report.id, id))
  if (!row) throw new Error("report not found")
  return row
}

describe("uploadTargetsFor", () => {
  test("uploadTargetsFor signs links for every declared file", async () => {
    const created = await createReportUpload(
      ctx,
      reporter,
      uploadBody(projectId, { captureType: "video", durationMs: 4000, mediaSize: 10, debuggerSize: 3, thumbnailSize: 5 }),
    )
    const targets = await uploadTargetsFor(ctx, await rowOf(created.reportId))
    expect(targets.mediaUpload?.method).toBe("PUT")
    expect(targets.debuggerUpload?.method).toBe("PUT")
    expect(targets.thumbnailUpload?.method).toBe("PUT")
    expect(targets.mediaParts).toBeNull()
  })
})
