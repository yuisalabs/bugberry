import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { eq } from "drizzle-orm"
import { report } from "../src/db/schema"
import { TrackerError } from "../src/lib/trackers/providers"
import {
  createIntegration,
  createProject,
  createReadyReport,
  createUserWithToken,
  fakeTrackers,
  setupTestApp,
  type FakeTrackers,
} from "./helpers"
import { callTool, mcpClient } from "./mcp-helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let trackers: FakeTrackers
let client: Client
let reportId: string
let integrationId: string
let member: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  trackers = fakeTrackers()
  ctx = await setupTestApp({}, { trackers: trackers.factory })
  const admin = await createUserWithToken(ctx.db, { role: "admin" })
  member = await createUserWithToken(ctx.db)
  const projectId = (await createProject(ctx.db)).id
  integrationId = (
    await createIntegration(ctx.db, {
      projectId,
      provider: "github",
      target: { owner: "kantor", repo: "web", labels: [] },
      secret: "ghp_token",
      name: "GitHub Kantor",
    })
  ).id
  reportId = (await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, title: "Pay fails" })).id
  client = await mcpClient(ctx.app, member.headers)
})

describe("tracker tools", () => {
  test("listTrackers shows the project's integrations and sent links", async () => {
    const { text } = await callTool(client, "listTrackers", { report: reportId })
    expect(text).toContain(`${integrationId} · github · GitHub Kantor · kantor/web`)
    expect(text).toContain("Not sent yet")
  })

  test("a report without a project says so", async () => {
    const loose = await createReadyReport(ctx.db, { reporterId: member.user.id })
    expect((await callTool(client, "listTrackers", { report: loose.id })).text).toBe(
      "This report has no project, so no trackers are set up. Move it to a project with updateReport first.",
    )
  })

  test("sendToTracker creates one issue and returns its URL; sending again returns the same link", async () => {
    const first = await callTool(client, "sendToTracker", { report: reportId, integrationId })
    expect(first.text).toContain("https://tracker.test/issues/1")
    const second = await callTool(client, "sendToTracker", { report: reportId, integrationId })
    expect(second.text).toContain("https://tracker.test/issues/1")
    expect(trackers.created).toHaveLength(1)
    expect((await callTool(client, "listTrackers", { report: reportId })).text).toContain("https://tracker.test/issues/1")
  })

  test("a tracker failure comes back as an error with the message", async () => {
    trackers.behaviour.createIssue = async () => {
      throw new TrackerError("GitHub refused the token")
    }
    const result = await callTool(client, "sendToTracker", { report: reportId, integrationId })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("GitHub refused the token")
  })
})

describe("notifiers are not trackers", () => {
  test("a Slack integration is not listed or sent to as a tracker", async () => {
    const admin = await createUserWithToken(ctx.db, { role: "admin" })
    const projectId = (await ctx.db.select().from(report).where(eq(report.id, reportId)))[0]?.projectId ?? ""
    const slackId = (await createIntegration(ctx.db, { projectId, provider: "slack", secret: "https://hooks.slack.com/services/T0/B0/xyz" })).id
    const listed = await ctx.api.api.reports({ id: reportId }).trackers.get({ headers: member.headers })
    expect(listed.data?.integrations.map((item) => item.id)).not.toContain(slackId)
    const { text } = await callTool(client, "listTrackers", { report: reportId })
    expect(text).not.toContain(slackId)
    const sent = await ctx.api.api.reports({ id: reportId }).trackers({ integrationId: slackId }).send.post(undefined, { headers: member.headers })
    expect(sent.error?.status as number | undefined).toBe(404)
  })
})
