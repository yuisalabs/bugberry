import { beforeEach, describe, expect, setSystemTime, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { integration, reportExternalLink } from "../src/db/schema"
import { TrackerError } from "../src/lib/trackers/providers"
import { LocalStorageDriver } from "../src/storage/local"
import {
  createProject,
  createReadyReport,
  createUserWithToken,
  type FakeTrackers,
  fakeTrackers,
  putUpload,
  setupTestApp,
  uploadBody,
  waitFor,
} from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let trackers: FakeTrackers
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string
let integrationId: string

beforeEach(async () => {
  trackers = fakeTrackers()
  ctx = await setupTestApp({}, { trackers: trackers.factory })
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  member = await createUserWithToken(ctx.db)
  projectId = (await createProject(ctx.db)).id
  const { data } = await ctx.api.api.projects({ id: projectId }).integrations.post(
    { provider: "github", config: { owner: "kantor", repo: "web", labels: [] }, secret: "ghp_token" },
    { headers: admin.headers },
  )
  integrationId = data?.id ?? ""
})

const sendFor = (reportId: string, id = integrationId) =>
  ctx.api.api.reports({ id: reportId }).trackers({ integrationId: id }).send.post(undefined, { headers: member.headers })

describe("sending a report to a tracker", () => {
  test("creates one issue with the report's content and remembers the link", async () => {
    if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage")
    const debuggerKey = "reports/with-errors/debugger.json.gz"
    const payload = { version: 1, events: [{ kind: "error", t: 1, message: "TypeError: total is undefined" }] }
    await ctx.storage.writeObject(debuggerKey, Bun.gzipSync(JSON.stringify(payload)))
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, title: "Pay fails", debuggerKey })

    const { data: link } = await sendFor(created.id)
    expect(link).toMatchObject({ integrationId, externalId: "1", externalUrl: "https://tracker.test/issues/1", error: null })
    expect(trackers.created).toHaveLength(1)
    expect(trackers.created[0]?.secret).toBe("ghp_token")
    expect(trackers.created[0]?.content).toMatchObject({
      title: "Pay fails",
      reportUrl: `http://localhost:3000/app/r/${created.id}`,
      errors: ["TypeError: total is undefined"],
    })

    const again = await sendFor(created.id)
    expect(again.data?.externalUrl).toBe("https://tracker.test/issues/1")
    expect(trackers.created).toHaveLength(1)
  })

  test("simultaneous sends create exactly one issue", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    let release: () => void = () => {}
    trackers.behaviour.createIssue = () =>
      new Promise((resolve) => {
        release = () => resolve({ externalId: "9", url: "https://tracker.test/issues/9" })
      })
    const first = sendFor(created.id)
    await waitFor(async () => trackers.created.length === 1)
    const second = await sendFor(created.id)
    expect(second.error?.status as number | undefined).toBe(409)
    expect(second.error?.value).toMatchObject({ code: "send_in_progress" })
    release()
    expect((await first).data?.externalId).toBe("9")
    expect(trackers.created).toHaveLength(1)
  })

  test("the lock uses the database clock, so a server clock running behind cannot unlock a send in progress", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    let release: () => void = () => {}
    // Only the first create waits; a duplicate would come back at once and show up in `created`.
    trackers.behaviour.createIssue = () =>
      trackers.created.length > 1
        ? Promise.resolve({ externalId: "10", url: "https://tracker.test/issues/10" })
        : new Promise((resolve) => {
            release = () => resolve({ externalId: "9", url: "https://tracker.test/issues/9" })
          })
    setSystemTime(new Date(Date.now() - 10 * 60 * 1000))
    try {
      const first = sendFor(created.id)
      await waitFor(async () => trackers.created.length === 1)
      const second = await sendFor(created.id)
      expect(second.error?.value).toMatchObject({ code: "send_in_progress" })
      release()
      expect((await first).data?.externalId).toBe("9")
    } finally {
      setSystemTime()
    }
    expect(trackers.created).toHaveLength(1)
  })

  test("an integration deleted while sending is reported as such", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    trackers.behaviour.createIssue = async () => {
      await ctx.db.delete(integration).where(eq(integration.id, integrationId))
      return { externalId: "5", url: "https://tracker.test/issues/5" }
    }
    const { error } = await sendFor(created.id)
    expect(error?.value).toMatchObject({ code: "integration_not_found" })
  })

  test("a failure is stored on the link and a later retry succeeds", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    trackers.behaviour.createIssue = async () => {
      throw new TrackerError("GitHub could not be reached")
    }
    const failed = await sendFor(created.id)
    expect(failed.data).toMatchObject({ externalId: null, error: "GitHub could not be reached" })

    trackers.behaviour.createIssue = undefined
    const retried = await sendFor(created.id)
    expect(retried.data).toMatchObject({ externalUrl: "https://tracker.test/issues/2", error: null })
  })

  test("a send stuck for more than two minutes can be taken over", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    await ctx.db.insert(reportExternalLink).values({
      id: "stuck",
      reportId: created.id,
      integrationId,
      updatedAt: new Date(Date.now() - 3 * 60 * 1000),
    })
    expect((await sendFor(created.id)).data?.externalId).toBe("1")
  })

  test("a sender whose claim was taken over does not overwrite the newer link", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    trackers.behaviour.createIssue = async () => {
      // Another sender took over the stale claim and finished first.
      await ctx.db
        .update(reportExternalLink)
        .set({ externalId: "77", externalUrl: "https://tracker.test/issues/77", updatedAt: new Date(Date.now() + 1000) })
        .where(eq(reportExternalLink.reportId, created.id))
      return { externalId: "9", url: "https://tracker.test/issues/9" }
    }
    const { data } = await sendFor(created.id)
    expect(data?.externalId).toBe("77")
    const [row] = await ctx.db.select().from(reportExternalLink).where(eq(reportExternalLink.reportId, created.id))
    expect(row?.externalUrl).toBe("https://tracker.test/issues/77")
  })

  test("an unreadable token is reported on the link without calling the tracker", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    await ctx.db.update(integration).set({ secretEncrypted: "v1.aaa.bbb.ccc" }).where(eq(integration.id, integrationId))
    const { data } = await sendFor(created.id)
    expect(data?.error).toContain("ENCRYPTION_KEY")
    expect(trackers.created).toHaveLength(0)
  })

  test("integrations of another project and unknown reports are refused", async () => {
    const other = await createProject(ctx.db)
    const foreign = await createReadyReport(ctx.db, { projectId: other.id, reporterId: member.user.id })
    expect((await sendFor(foreign.id)).error?.status as number | undefined).toBe(404)
    expect((await sendFor("missing")).error?.status as number | undefined).toBe(404)
  })

  test("a report without a project lists no trackers and says it needs a project", async () => {
    const created = await createReadyReport(ctx.db, { projectId: null, reporterId: member.user.id })
    const { data } = await ctx.api.api.reports({ id: created.id }).trackers.get({ headers: member.headers })
    expect(data).toMatchObject({ integrations: [], needsProject: true })
  })

  test("sending a report without a project explains why it cannot", async () => {
    const created = await createReadyReport(ctx.db, { projectId: null, reporterId: member.user.id })
    const { error } = await sendFor(created.id)
    expect(error?.status as number | undefined).toBe(422)
    expect(error?.value).toMatchObject({ code: "report_has_no_project" })
    expect(trackers.created).toHaveLength(0)
  })

  test("members see the project's integrations and the report's links", async () => {
    const created = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    await sendFor(created.id)
    const { data } = await ctx.api.api.reports({ id: created.id }).trackers.get({ headers: member.headers })
    expect(data?.integrations).toEqual([{ id: integrationId, provider: "github", label: "kantor/web", autoSend: false }])
    expect(data?.links).toHaveLength(1)
    expect(JSON.stringify(data)).not.toContain("ghp_token")
  })
})

describe("auto-send", () => {
  /** Background auto-sends started by finalize, so a test can wait for them instead of sleeping. */
  let background: Promise<unknown>[]

  beforeEach(async () => {
    background = []
    ctx = await setupTestApp({}, { trackers: trackers.factory, background: (task) => void background.push(task) })
    admin = await createUserWithToken(ctx.db, { role: "admin" })
    member = await createUserWithToken(ctx.db)
    projectId = (await createProject(ctx.db)).id
    const { data } = await ctx.api.api.projects({ id: projectId }).integrations.post(
      { provider: "github", config: { owner: "kantor", repo: "web", labels: [] }, secret: "ghp_token" },
      { headers: admin.headers },
    )
    integrationId = data?.id ?? ""
  })

  const finishedUpload = async () => {
    const session = (await ctx.api.api.reports.uploads.post(uploadBody(projectId), { headers: member.headers })).data
    if (!session) throw new Error("no upload session")
    await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))
    return session
  }
  const finalize = (reportId: string) =>
    ctx.api.api.reports({ id: reportId }).finalize.post(undefined, { headers: member.headers })
  const enableAutoSend = () =>
    ctx.api.api.projects({ id: projectId }).integrations({ integrationId }).patch({ autoSend: true }, { headers: admin.headers })

  test("finalizing a report sends it to integrations marked auto-send, once", async () => {
    await enableAutoSend()
    const session = await finishedUpload()
    await finalize(session.reportId)
    await Promise.all(background)
    const [link] = await ctx.db.select().from(reportExternalLink).where(eq(reportExternalLink.reportId, session.reportId))
    expect(link?.externalUrl).toBe("https://tracker.test/issues/1")

    await finalize(session.reportId)
    await Promise.all(background)
    expect(trackers.created).toHaveLength(1)
  })

  test("moving a report into a project never auto-sends", async () => {
    await enableAutoSend()
    const created = await createReadyReport(ctx.db, { projectId: null, reporterId: member.user.id })
    const { data } = await ctx.api.api.reports({ id: created.id }).patch({ projectId }, { headers: member.headers })
    expect(data?.projectId).toBe(projectId)
    await Promise.all(background)
    expect(background).toHaveLength(0)
    expect(trackers.created).toHaveLength(0)
  })

  test("integrations without auto-send are left alone", async () => {
    const session = await finishedUpload()
    await finalize(session.reportId)
    expect(background).toHaveLength(1)
    await Promise.all(background)
    expect(trackers.created).toHaveLength(0)
  })

  test("a manual send while auto-send is still running creates no second issue", async () => {
    await enableAutoSend()
    let release: () => void = () => {}
    trackers.behaviour.createIssue = () =>
      new Promise((resolve) => {
        release = () => resolve({ externalId: "9", url: "https://tracker.test/issues/9" })
      })
    const session = await finishedUpload()
    await finalize(session.reportId)
    await waitFor(async () => trackers.created.length === 1)

    const manual = await sendFor(session.reportId)
    expect(manual.error?.value).toMatchObject({ code: "send_in_progress" })
    release()
    await Promise.all(background)
    expect(trackers.created).toHaveLength(1)
    expect((await sendFor(session.reportId)).data?.externalId).toBe("9")
  })
})
