import { beforeEach, describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { TrackerError } from "../src/lib/trackers/providers"
import { createProject, createReadyReport, createUserWithToken, type FakeTrackers, fakeTrackers, setupTestApp } from "./helpers"
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
  const { data } = await ctx.api.api.projects({ id: projectId }).integrations.post(
    { provider: "github", config: { owner: "kantor", repo: "web", labels: [] }, secret: "ghp_token" },
    { headers: admin.headers },
  )
  integrationId = data?.id ?? ""
  reportId = (await createReadyReport(ctx.db, { projectId, reporterId: member.user.id, title: "Pay fails" })).id
  client = await mcpClient(ctx.app, member.headers)
})

describe("tracker tools", () => {
  test("listTrackers shows the project's integrations and sent links", async () => {
    const { text } = await callTool(client, "listTrackers", { report: reportId })
    expect(text).toContain(`${integrationId} · github · kantor/web`)
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
