import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { integration, reportExternalLink } from "../src/db/schema"
import type { NotifierFactory } from "../src/lib/notifiers/channels"
import type { NewReportMessage } from "../src/lib/notifiers/message"
import {
  createIntegration,
  createProject,
  createReadyReport,
  createUserWithToken,
  createWorkspaceRow,
  type FakeTrackers,
  fakeTrackers,
  setupTestApp,
} from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let trackers: FakeTrackers
let sent: Array<{ secret: string; message: NewReportMessage }>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let member: Awaited<ReturnType<typeof createUserWithToken>>

const notifiers: NotifierFactory = (_provider, _config, secret) => ({
  async send(message) {
    sent.push({ secret, message })
  },
})

beforeEach(async () => {
  trackers = fakeTrackers()
  sent = []
  ctx = await setupTestApp({}, { trackers: trackers.factory, notifiers })
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  member = await createUserWithToken(ctx.db)
})

const connections = () => ctx.api.api.workspaces({ id: ctx.workspace.id }).connections
const one = (connectionId: string) => ctx.api.api.workspaces({ id: ctx.workspace.id }).connections({ connectionId })

const JIRA = {
  provider: "jira" as const,
  name: "Jira",
  settings: { siteUrl: "https://kantor.atlassian.net", email: "dana@kantor.test" },
  secret: "atl_secret",
}

describe("workspace connections", () => {
  test("an admin adds a connection; members see its name and status but no settings", async () => {
    const created = await connections().post(JIRA, { headers: admin.headers })
    expect(created.data).toMatchObject({ provider: "jira", name: "Jira", settings: JIRA.settings, usedIn: 0, usedBy: [] })
    const asAdmin = await connections().get({ headers: admin.headers })
    expect(asAdmin.data?.[0]).toMatchObject({ settings: { siteUrl: "https://kantor.atlassian.net" } })
    const asMember = await connections().get({ headers: member.headers })
    expect(asMember.data).toEqual([
      {
        id: created.data?.id ?? "",
        provider: "jira",
        kind: "tracker",
        name: "Jira",
        usedIn: 0,
        status: { failing: 0, lastError: null, lastDeliveredAt: null },
      },
    ])
    for (const body of [created.data, asAdmin.data, asMember.data]) expect(JSON.stringify(body)).not.toContain("atl_secret")
  })

  test("members cannot add, change, test or delete connections", async () => {
    expect((await connections().post(JIRA, { headers: member.headers })).error?.status as number | undefined).toBe(403)
    const { data } = await connections().post(JIRA, { headers: admin.headers })
    const id = data?.id ?? ""
    expect((await one(id).patch({ name: "Mine" }, { headers: member.headers })).error?.status as number | undefined).toBe(403)
    expect((await one(id).test.post(undefined, { headers: member.headers })).error?.status as number | undefined).toBe(403)
    expect((await one(id).delete(undefined, { headers: member.headers })).error?.status as number | undefined).toBe(403)
  })

  test("a connection from another workspace is not found", async () => {
    const other = await createWorkspaceRow(ctx.db, "Other")
    const elsewhere = await createProject(ctx.db, { workspaceId: other.id })
    const foreign = await createIntegration(ctx.db, { projectId: elsewhere.id, provider: "slack" })
    const patched = await one(foreign.connectionId).patch({ name: "Taken" }, { headers: admin.headers })
    expect(patched.error?.value).toMatchObject({ code: "connection_not_found" })
    const deleted = await one(foreign.connectionId).delete(undefined, { headers: admin.headers })
    expect(deleted.error?.value).toMatchObject({ code: "connection_not_found" })
  })

  test("deleting a connection names its projects first and keeps sent issues", async () => {
    const checkout = await createProject(ctx.db, { name: "Checkout Web" })
    const panel = await createProject(ctx.db, { name: "Admin Panel" })
    const first = await createIntegration(ctx.db, {
      projectId: checkout.id,
      provider: "github",
      name: "GitHub Kantor",
      target: { owner: "kantor", repo: "web", labels: [] },
    })
    await createIntegration(ctx.db, {
      projectId: panel.id,
      provider: "github",
      connectionId: first.connectionId,
      target: { owner: "kantor", repo: "admin", labels: [] },
    })
    const listed = await connections().get({ headers: admin.headers })
    const row = listed.data?.find((item) => item.id === first.connectionId)
    expect(row?.usedIn).toBe(2)
    expect((row as { usedBy?: Array<{ projectName: string }> } | undefined)?.usedBy?.map((use) => use.projectName).sort()).toEqual([
      "Admin Panel",
      "Checkout Web",
    ])

    const report = await createReadyReport(ctx.db, { projectId: checkout.id, reporterId: member.user.id })
    await ctx.api.api.reports({ id: report.id }).trackers({ integrationId: first.id }).send.post(undefined, { headers: member.headers })
    expect((await one(first.connectionId).delete(undefined, { headers: admin.headers })).data).toEqual({ ok: true })

    const [link] = await ctx.db.select().from(reportExternalLink).where(eq(reportExternalLink.reportId, report.id))
    expect(link).toMatchObject({ integrationId: null, provider: "github", externalId: "1" })
    const trackersOfReport = await ctx.api.api.reports({ id: report.id }).trackers.get({ headers: member.headers })
    expect(trackersOfReport.data?.integrations).toEqual([])
  })

  test("replacing the token keeps every use working", async () => {
    const project = await createProject(ctx.db)
    const use = await createIntegration(ctx.db, {
      projectId: project.id,
      provider: "github",
      target: { owner: "kantor", repo: "web", labels: [] },
      secret: "ghp_old",
    })
    await one(use.connectionId).patch({ secret: "ghp_new" }, { headers: admin.headers })
    const report = await createReadyReport(ctx.db, { projectId: project.id, reporterId: member.user.id })
    await ctx.api.api.reports({ id: report.id }).trackers({ integrationId: use.id }).send.post(undefined, { headers: member.headers })
    expect(trackers.created[0]?.secret).toBe("ghp_new")
  })

  test("status shows failing uses", async () => {
    const a = await createProject(ctx.db)
    const b = await createProject(ctx.db)
    const slack = await createIntegration(ctx.db, { projectId: a.id, provider: "slack" })
    const other = await createIntegration(ctx.db, { projectId: b.id, provider: "slack", connectionId: slack.connectionId })
    await ctx.db.update(integration).set({ lastError: "Slack rejected the message (HTTP 404)" }).where(eq(integration.id, other.id))
    const { data } = await connections().get({ headers: member.headers })
    expect(data?.[0]?.status).toMatchObject({ failing: 1, lastError: "Slack rejected the message (HTTP 404)" })
  })

  test("Slack test message is sent once from the workspace", async () => {
    const { data } = await connections().post(
      { provider: "slack", name: "Slack #qa", settings: {}, secret: "https://hooks.slack.com/services/T0/B0/x" },
      { headers: admin.headers },
    )
    const tested = await one(data?.id ?? "").test.post(undefined, { headers: admin.headers })
    expect(tested.data).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ secret: "https://hooks.slack.com/services/T0/B0/x", message: { test: true } })
  })

  test("Slack and Discord only take their own webhook URLs", async () => {
    const wrong = await connections().post(
      { provider: "slack", name: "Slack", settings: {}, secret: "https://hooks.slack.com.evil.test/services/x" },
      { headers: admin.headers },
    )
    expect(wrong.error?.value).toMatchObject({ code: "invalid_webhook_url" })
  })
})

describe("private addresses", () => {
  test("a connection pointing into a private network is refused unless the server allows it", async () => {
    const strict = await setupTestApp({ allowPrivateIntegrationHosts: false }, { trackers: fakeTrackers().factory })
    const owner = await createUserWithToken(strict.db, { role: "admin" })
    const add = (body: Parameters<ReturnType<typeof strict.api.api.workspaces>["connections"]["post"]>[0]) =>
      strict.api.api.workspaces({ id: strict.workspace.id }).connections.post(body, { headers: owner.headers })
    expect((await add({ provider: "webhook", name: "Hook", settings: { url: "https://10.0.0.5/hook" } })).error?.value).toMatchObject({
      code: "private_address",
    })
    const gitlab = await add({ provider: "gitlab", name: "GitLab", settings: { baseUrl: "https://192.168.1.20" }, secret: "glpat" })
    expect(gitlab.error?.value).toMatchObject({ code: "private_address" })
  })
})
