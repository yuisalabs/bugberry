import { beforeEach, describe, expect, test } from "bun:test"
import type { NotifierConfig, NotifierProvider } from "@bugberry/shared"
import { eq } from "drizzle-orm"
import { integration } from "../src/db/schema"
import type { NotifierFactory } from "../src/lib/notifiers/channels"
import { notifyNewReport } from "../src/lib/notifiers/deliver"
import type { NewReportMessage } from "../src/lib/notifiers/message"
import { TrackerError } from "../src/lib/trackers/providers"
import {
  createIntegration,
  createProject,
  createReadyReport,
  createUserWithToken,
  putUpload,
  setupTestApp,
  uploadBody,
} from "./helpers"

interface Sent {
  provider: NotifierProvider
  config: NotifierConfig
  secret: string
  message: NewReportMessage
}

function fakeNotifiers() {
  const sent: Sent[] = []
  /** Secrets whose channel refuses every message. */
  const failing = new Set<string>()
  const factory: NotifierFactory = (provider, config, secret) => ({
    async send(message) {
      sent.push({ provider, config, secret, message })
      if (failing.has(secret)) throw new TrackerError("Slack rejected the message (HTTP 500)")
    },
  })
  return { sent, failing, factory }
}

const SLACK = "https://hooks.slack.com/services/T0/B0/one"
const DISCORD = "https://discord.com/api/webhooks/1/two"

let notifiers: ReturnType<typeof fakeNotifiers>
let tasks: Promise<unknown>[]
let ctx: Awaited<ReturnType<typeof setupTestApp>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let project: Awaited<ReturnType<typeof createProject>>

beforeEach(async () => {
  notifiers = fakeNotifiers()
  tasks = []
  ctx = await setupTestApp({}, { notifiers: notifiers.factory, background: (task) => tasks.push(task) })
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  member = await createUserWithToken(ctx.db)
  project = await createProject(ctx.db, { name: "Checkout Web" })
})

async function addChannel(provider: "slack" | "discord", secret: string, projectId = project.id) {
  return (await createIntegration(ctx.db, { projectId, provider, secret })).id
}

async function finalizeReport(projectId: string | null) {
  const session = (await ctx.api.api.reports.uploads.post(uploadBody(projectId), { headers: member.headers })).data
  if (!session) throw new Error("no upload session")
  await putUpload(ctx.app, session.mediaUpload, new Uint8Array([1, 2, 3, 4]))
  await ctx.api.api.reports({ id: session.reportId }).finalize.post(undefined, { headers: member.headers })
  await Promise.all(tasks)
  return session.reportId
}

const rowOf = async (id: string) => (await ctx.db.select().from(integration).where(eq(integration.id, id)))[0]

describe("new-report notifications", () => {
  test("one Slack connection used by two projects posts once per project", async () => {
    const other = await createProject(ctx.db, { name: "Admin Panel" })
    const slack = await createIntegration(ctx.db, { projectId: project.id, provider: "slack", secret: SLACK })
    const second = await createIntegration(ctx.db, { projectId: other.id, provider: "slack", connectionId: slack.connectionId })
    await finalizeReport(project.id)
    expect(notifiers.sent).toHaveLength(1)
    expect(notifiers.sent[0]).toMatchObject({ secret: SLACK, message: { projectName: "Checkout Web" } })
    await finalizeReport(other.id)
    expect(notifiers.sent).toHaveLength(2)
    expect(notifiers.sent[1]).toMatchObject({ secret: SLACK, message: { projectName: "Admin Panel" } })
    expect((await rowOf(second.id))?.lastDeliveredAt).toBeInstanceOf(Date)
  })

  test("a finalized report notifies every channel of its project", async () => {
    const slack = await addChannel("slack", SLACK)
    await addChannel("discord", DISCORD)
    const reportId = await finalizeReport(project.id)
    expect(notifiers.sent.map((item) => item.provider).sort()).toEqual(["discord", "slack"])
    for (const item of notifiers.sent) {
      expect(item.message).toMatchObject({ reportId, number: 1, title: "Checkout button broken", projectName: "Checkout Web" })
      expect(item.message.reporterName).toBe(member.user.name)
    }
    expect(notifiers.sent.find((item) => item.provider === "slack")?.secret).toBe(SLACK)
    expect(await rowOf(slack)).toMatchObject({ lastError: null })
    expect((await rowOf(slack))?.lastDeliveredAt).toBeInstanceOf(Date)
  })

  test("a report with no project notifies nobody", async () => {
    await addChannel("slack", SLACK)
    await finalizeReport(null)
    expect(notifiers.sent).toHaveLength(0)
  })

  test("a failing channel is retried three times, then shows its last error", async () => {
    const slack = await addChannel("slack", SLACK)
    const discord = await addChannel("discord", DISCORD)
    notifiers.failing.add(SLACK)
    const created = await createReadyReport(ctx.db, { projectId: project.id, reporterId: member.user.id })
    const waits: number[] = []
    await notifyNewReport({ ...ctx, notifiers: notifiers.factory }, created.id, { sleep: async (ms) => void waits.push(ms) })
    expect(notifiers.sent.filter((item) => item.provider === "slack")).toHaveLength(3)
    expect(notifiers.sent.filter((item) => item.provider === "discord")).toHaveLength(1)
    expect(waits).toEqual([5_000, 30_000])
    expect(await rowOf(slack)).toMatchObject({ lastError: "Slack rejected the message (HTTP 500)", lastDeliveredAt: null })
    expect(await rowOf(discord)).toMatchObject({ lastError: null })
    expect((await rowOf(discord))?.lastDeliveredAt).toBeInstanceOf(Date)
  })

  test("Send test message reaches the channel once", async () => {
    const slack = await addChannel("slack", SLACK)
    const sendTest = () =>
      ctx.api.api.projects({ id: project.id }).integrations({ integrationId: slack }).test.post(undefined, { headers: admin.headers })
    await ctx.db.update(integration).set({ lastError: "Slack rejected the message (HTTP 404)" }).where(eq(integration.id, slack))
    const ok = await sendTest()
    expect(ok.data).toEqual({ ok: true })
    // A passing test shows the channel works again.
    expect(await rowOf(slack)).toMatchObject({ lastError: null })
    expect((await rowOf(slack))?.lastDeliveredAt).toBeInstanceOf(Date)
    expect(notifiers.sent).toHaveLength(1)
    expect(notifiers.sent[0]?.message).toMatchObject({ test: true, title: "BugBerry test message", projectName: "Checkout Web" })

    notifiers.failing.add(SLACK)
    const failed = await sendTest()
    expect(failed.error?.status as number | undefined).toBe(422)
    expect(failed.error?.value).toMatchObject({ code: "integration_test_failed", message: "Slack rejected the message (HTTP 500)" })
    expect(notifiers.sent).toHaveLength(2)
  })
})
