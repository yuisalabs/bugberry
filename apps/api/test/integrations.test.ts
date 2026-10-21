import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { integration, reportExternalLink } from "../src/db/schema"
import type { NotifierFactory } from "../src/lib/notifiers/channels"
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
let posted: string[]
let member: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string
let github: { id: string; connectionId: string }

const notifiers: NotifierFactory = (_provider, _config, secret) => ({
  async send() {
    posted.push(secret)
  },
})

beforeEach(async () => {
  trackers = fakeTrackers()
  posted = []
  ctx = await setupTestApp({}, { trackers: trackers.factory, notifiers })
  member = await createUserWithToken(ctx.db)
  projectId = (await createProject(ctx.db, { name: "Checkout Web" })).id
  // A connection the workspace already has, used by another project.
  const other = await createProject(ctx.db)
  github = await createIntegration(ctx.db, {
    projectId: other.id,
    provider: "github",
    name: "GitHub Kantor",
    secret: "ghp_secret",
    target: { owner: "kantor", repo: "admin", labels: [] },
  })
})

const uses = () => ctx.api.api.projects({ id: projectId }).integrations
const use = (integrationId: string) => ctx.api.api.projects({ id: projectId }).integrations({ integrationId })
const addGithub = (repo: string, labels: string[] = []) =>
  uses().post({ connectionId: github.connectionId, target: { owner: "kantor", repo, labels } }, { headers: member.headers })

describe("project uses of workspace connections", () => {
  test("a member uses a workspace connection in a project", async () => {
    const added = await addGithub("checkout", ["bug", " bug "])
    expect(added.data).toMatchObject({
      provider: "github",
      kind: "tracker",
      connection: { id: github.connectionId, name: "GitHub Kantor" },
      target: { owner: "kantor", repo: "checkout", labels: ["bug"] },
      label: "kantor/checkout",
      autoSend: false,
    })
    const { data } = await uses().get({ headers: member.headers })
    expect(data?.map((item) => item.label)).toEqual(["kantor/checkout"])
    expect(JSON.stringify(data)).not.toContain("ghp_secret")
    expect(JSON.stringify(data)).not.toContain("settings")
  })

  test("the same connection and target twice is refused", async () => {
    expect((await addGithub("checkout")).data?.label).toBe("kantor/checkout")
    const again = await addGithub("Checkout", ["other"])
    expect(again.error?.status as number | undefined).toBe(409)
    expect(again.error?.value).toMatchObject({ code: "already_used" })
    expect((await addGithub("web")).data?.label).toBe("kantor/web")
    const [one, two] = await Promise.all([addGithub("shop"), addGithub("shop")])
    const statuses = [one, two].map((answer) => (answer.error ? (answer.error.status as number) : 200)).sort()
    expect(statuses).toEqual([200, 409])
  })

  test("Slack is used once per project", async () => {
    const slack = await createIntegration(ctx.db, { projectId: (await createProject(ctx.db)).id, provider: "slack" })
    const first = await uses().post({ connectionId: slack.connectionId, target: {} }, { headers: member.headers })
    expect(first.data).toMatchObject({ kind: "notifier", label: "slack", autoSend: false })
    const second = await uses().post({ connectionId: slack.connectionId, target: {} }, { headers: member.headers })
    expect(second.error?.value).toMatchObject({ code: "already_used" })
  })

  test("another workspace's connection cannot be used", async () => {
    const elsewhere = await createProject(ctx.db, { workspaceId: (await createWorkspaceRow(ctx.db, "Other")).id })
    const foreign = await createIntegration(ctx.db, { projectId: elsewhere.id, provider: "slack" })
    const { error } = await uses().post({ connectionId: foreign.connectionId, target: {} }, { headers: member.headers })
    expect(error?.value).toMatchObject({ code: "connection_not_found" })
  })

  test("a target of another provider is refused", async () => {
    const { error } = await uses().post({ connectionId: github.connectionId, target: { chatId: "-100" } }, { headers: member.headers })
    expect(error?.value).toMatchObject({ code: "invalid_target" })
  })

  test("a target that breaks a limit says which", async () => {
    const labels = Array.from({ length: 11 }, (_, index) => `label-${index}`)
    const many = await uses().post({ connectionId: github.connectionId, target: { owner: "kantor", repo: "web", labels } }, { headers: member.headers })
    expect(many.error?.value).toMatchObject({ code: "invalid_target", message: "Use at most 10 labels of up to 50 characters each" })
    const jira = await createIntegration(ctx.db, {
      projectId: (await createProject(ctx.db)).id,
      provider: "jira",
      settings: { siteUrl: "https://kantor.atlassian.net", email: "dana@kantor.test" },
      target: { projectKey: "BUG", issueType: "Bug", labels: [] },
    })
    const longKey = await uses().post(
      { connectionId: jira.connectionId, target: { projectKey: "TOOLONGPROJECTKEY", issueType: "Bug", labels: [] } },
      { headers: member.headers },
    )
    expect(longKey.error?.value).toMatchObject({ code: "invalid_target", message: "Enter the project key, such as BUG" })
  })

  test("a Plane project is used with its name, and only a real project id is taken", async () => {
    const plane = await createIntegration(ctx.db, {
      projectId: (await createProject(ctx.db)).id,
      provider: "plane",
      settings: { baseUrl: "https://api.plane.so", workspaceSlug: "kantor" },
      target: { projectId: "11111111-2222-4333-8444-555555555555", projectName: "Admin (ADM)", labels: [] },
    })
    const added = await uses().post(
      {
        connectionId: plane.connectionId,
        target: { projectId: "b7e42a19-3c5d-4f80-9a26-8d1c0f4e7b53", projectName: "Website (WEB)", labels: ["bug"] },
      },
      { headers: member.headers },
    )
    expect(added.data).toMatchObject({ provider: "plane", label: "Website (WEB)", target: { labels: ["bug"] } })
    const wrong = await uses().post(
      { connectionId: plane.connectionId, target: { projectId: "../users", projectName: "X", labels: [] } },
      { headers: member.headers },
    )
    expect(wrong.error?.value).toMatchObject({ code: "invalid_target", message: "That Plane project is not valid" })
  })

  test("a notifier never sends every report as an issue", async () => {
    const slack = await createIntegration(ctx.db, { projectId: (await createProject(ctx.db)).id, provider: "slack" })
    const { data } = await uses().post({ connectionId: slack.connectionId, target: {}, autoSend: true }, { headers: member.headers })
    expect(data?.autoSend).toBe(false)
  })

  test("editing a use changes labels and auto-send only", async () => {
    const id = (await addGithub("checkout")).data?.id ?? ""
    const edited = await use(id).patch({ labels: ["from-qa"], autoSend: true }, { headers: member.headers })
    expect(edited.data).toMatchObject({ target: { owner: "kantor", repo: "checkout", labels: ["from-qa"] }, autoSend: true })
    const moved = await use(id).patch({ target: { owner: "kantor", repo: "web", labels: [] } } as never, { headers: member.headers })
    expect(moved.error?.status as number | undefined).toBe(422)
  })

  test("removing a use keeps its sent issues", async () => {
    const id = (await addGithub("checkout")).data?.id ?? ""
    const report = await createReadyReport(ctx.db, { projectId, reporterId: member.user.id })
    await ctx.api.api.reports({ id: report.id }).trackers({ integrationId: id }).send.post(undefined, { headers: member.headers })
    expect((await use(id).delete(undefined, { headers: member.headers })).data).toEqual({ ok: true })
    const [link] = await ctx.db.select().from(reportExternalLink).where(eq(reportExternalLink.reportId, report.id))
    expect(link).toMatchObject({ integrationId: null, provider: "github", externalId: "1" })
  })

  test("a tracker use is tested against its target", async () => {
    const id = (await addGithub("checkout")).data?.id ?? ""
    expect((await use(id).test.post(undefined, { headers: member.headers })).data).toEqual({ ok: true })
    expect(trackers.tests[0]).toMatchObject({ config: { owner: "kantor", repo: "checkout", labels: [] }, secret: "ghp_secret" })
  })

  test("a member sends a test message and clears the last error", async () => {
    const slack = await createIntegration(ctx.db, { projectId, provider: "slack", secret: "https://hooks.slack.com/services/x" })
    await ctx.db.update(integration).set({ lastError: "Slack rejected the message (HTTP 404)" }).where(eq(integration.id, slack.id))
    expect((await use(slack.id).test.post(undefined, { headers: member.headers })).data).toEqual({ ok: true })
    expect(posted).toEqual(["https://hooks.slack.com/services/x"])
    const [row] = await ctx.db.select().from(integration).where(eq(integration.id, slack.id))
    expect(row?.lastError).toBeNull()
    expect(row?.lastDeliveredAt).toBeInstanceOf(Date)
  })

  test("a use of another project is not found", async () => {
    const { error } = await use(github.id).delete(undefined, { headers: member.headers })
    expect(error?.value).toMatchObject({ code: "integration_not_found" })
  })
})
