import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { treaty } from "@elysiajs/eden"
import {
  type ConnectionSettings,
  type IntegrationProvider,
  type TrackerConfig,
  type TrackerProvider,
  targetKey,
  type UseTarget,
  type WorkspaceRole,
} from "@bugberry/shared"
import { sql } from "drizzle-orm"
import { createApp } from "../src/app"
import { createAuth } from "../src/modules/auth/better-auth"
import type { EmailSender } from "../src/email/sender"
import type { Config } from "../src/config"
import { createDb, type Db } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"
import { apiToken, connection, integration, project, report, user, workspace, workspaceMember } from "../src/db/schema"
import { createSecretBox } from "../src/lib/secret-box"
import { generateApiToken, hashToken } from "../src/lib/api-token"
import { newId, newShareSlug } from "../src/lib/ids"
import type { IssueContent } from "../src/lib/trackers/content"
import type { CreatedIssue, TrackerFactory } from "../src/lib/trackers/providers"
import type { CreateUploadBody } from "../src/modules/reports/model"
import { claimReportNumber } from "../src/modules/reports/numbers"
import { freeSlug } from "../src/workspaces/slug"
import { createStorage } from "../src/storage"
import type { UploadTarget } from "../src/storage/types"
import type { NotifierFactory } from "../src/lib/notifiers/channels"
import type { AccountFactory } from "../src/lib/integrations/accounts"

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://fdebag:fdebag@localhost:54329/fdebag_test"

/** Every table in the public schema. Add new tables here when later plans create them. */
const TABLES = [
  "report_template",
  "workspace_ai_provider",
  "demo_request",
  "oauth_client_assertion",
  "oauth_consent",
  "oauth_access_token",
  "oauth_refresh_token",
  "oauth_client_resource",
  "oauth_resource",
  "oauth_client",
  "jwks",
  "notification",
  "pending_avatar",
  "pending_logo",
  "join_request",
  "workspace_invitation",
  "workspace_member",
  "report_external_link",
  "integration",
  "comment",
  "report",
  "project",
  "api_token",
  "session",
  "account",
  "verification",
  "user",
  "workspace",
]

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")

let dbPromise: Promise<Db> | null = null

export function getTestDb(): Promise<Db> {
  dbPromise ??= (async () => {
    const db = createDb(TEST_DATABASE_URL)
    await runMigrations(db)
    return db
  })()
  return dbPromise
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.map((name) => `"${name}"`).join(", ")} CASCADE`))
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    appUrl: "http://localhost:3000",
    databaseUrl: TEST_DATABASE_URL,
    authSecret: "test-secret-test-secret-test-secret-0000",
    google: { clientId: "test-client-id", clientSecret: "test-client-secret" },
    github: null,
    gitlab: null,
    email: { driver: "log", from: "BugBerry <no-reply@test>" },
    allowedEmailDomains: ["kantor.test"],
    extensionId: "testextensionid",
    extensionInstallUrl: null,
    maxUploadBytes: 1024 * 1024,
    uploadUrlTtlSeconds: 3600,
    readUrlTtlSeconds: 3600,
    proxyHops: 0,
    encryptionKey: TEST_ENCRYPTION_KEY,
    storage: { driver: "local", dir: mkdtempSync(join(tmpdir(), "bugberry-test-")) },
    accountLimits: null,
    allowPrivateIntegrationHosts: true,
    publicSite: false,
    demoRequestEmail: null,
    ...overrides,
  }
}

export async function setupTestApp(
  overrides: Partial<Config> = {},
  extra: {
    trackers?: TrackerFactory
    notifiers?: NotifierFactory
    accounts?: AccountFactory
    background?: (task: Promise<unknown>) => void
    email?: EmailSender
    aiFetch?: typeof fetch
    aiLookup?: (host: string) => Promise<string[]>
  } = {},
) {
  const db = await getTestDb()
  await resetDb(db)
  const config = testConfig(overrides)
  const storage = createStorage(config)
  const betterAuth = createAuth(config, db, { email: extra.email })
  const app = createApp({
    config,
    db,
    storage,
    betterAuth,
    trackers: extra.trackers,
    notifiers: extra.notifiers,
    accounts: extra.accounts,
    background: extra.background,
    email: extra.email,
    aiFetch: extra.aiFetch,
    aiLookup: extra.aiLookup,
  })
  const testWorkspace = await createWorkspaceRow(db, "Test")
  defaultWorkspaceId = testWorkspace.id
  return { app, api: treaty(app), db, config, storage, betterAuth, workspace: testWorkspace }
}

/** A Cookie header for a dashboard session, signed the way Better Auth signs its cookie. */
export async function sessionHeaders(
  ctx: { betterAuth: ReturnType<typeof createAuth>; config: Config },
  userId: string,
): Promise<{ cookie: string }> {
  const auth = await ctx.betterAuth.$context
  const session = await auth.internalAdapter.createSession(userId)
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ctx.config.authSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(session.token))).toString("base64")
  return { cookie: `${auth.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}` }
}

/** The workspace the last setupTestApp made; users, projects and reports land in it unless told otherwise. */
let defaultWorkspaceId: string | null = null

function currentTestWorkspace(): string {
  if (!defaultWorkspaceId) throw new Error("call setupTestApp first")
  return defaultWorkspaceId
}

export async function createWorkspaceRow(db: Db, name: string) {
  const [row] = await db.insert(workspace).values({ id: newId(), name, slug: await freeSlug(db, name) }).returning()
  if (!row) throw new Error("failed to insert workspace")
  return row
}

export async function addMember(db: Db, workspaceId: string, userId: string, role: WorkspaceRole = "member") {
  await db.insert(workspaceMember).values({ workspaceId, userId, role })
}

interface UserInput {
  email?: string
  name?: string
  /** The role in the test workspace (shorthand for workspaceRole). */
  role?: WorkspaceRole
  /** Defaults to the test workspace; null makes a user in no workspace. */
  workspaceId?: string | null
  /** Defaults to `role`. */
  workspaceRole?: WorkspaceRole
}

export async function createUser(db: Db, input: UserInput = {}) {
  const workspaceId = input.workspaceId === undefined ? currentTestWorkspace() : input.workspaceId
  const [row] = await db
    .insert(user)
    .values({
      id: newId(),
      email: input.email ?? `${newId()}@kantor.test`,
      name: input.name ?? "Test User",
      emailVerified: true,
      lastWorkspaceId: workspaceId,
    })
    .returning()
  if (!row) throw new Error("failed to insert user")
  if (workspaceId) await addMember(db, workspaceId, row.id, input.workspaceRole ?? input.role ?? "member")
  return row
}

export async function createUserWithToken(db: Db, input: UserInput & { kind?: "full" | "mcp" } = {}) {
  const created = await createUser(db, input)
  const token = generateApiToken()
  await db.insert(apiToken).values({ id: newId(), userId: created.id, tokenHash: hashToken(token), label: "test", kind: input.kind ?? "full" })
  return { user: created, token, headers: { authorization: `Bearer ${token}` } }
}

export async function createProject(
  db: Db,
  input: { name?: string; slug?: string; urlPatterns?: string[]; workspaceId?: string } = {},
) {
  const [row] = await db
    .insert(project)
    .values({
      id: newId(),
      workspaceId: input.workspaceId ?? currentTestWorkspace(),
      name: input.name ?? "Web App",
      slug: input.slug ?? `web-${newShareSlug().toLowerCase()}`,
      urlPatterns: input.urlPatterns ?? [],
    })
    .returning()
  if (!row) throw new Error("failed to insert project")
  return row
}

export async function createReadyReport(
  db: Db,
  input: { projectId?: string | null; reporterId: string } & Partial<typeof report.$inferInsert>,
) {
  const id = input.id ?? newId()
  const workspaceId = input.workspaceId ?? currentTestWorkspace()
  const [row] = await db
    .insert(report)
    .values({
      id,
      title: "Button does nothing",
      captureType: "screenshot",
      pageUrl: "https://app.kantor.test/page",
      device: { browser: "Chrome 140", os: "Windows 11", viewport: "1440x900" },
      mediaKey: `reports/${id}/media.png`,
      mediaType: "image/png",
      mediaSize: 3,
      debuggerSummary: { logs: 0, errors: 0, requests: 0, failedRequests: 0, actions: 0, incomplete: [] },
      shareSlug: newShareSlug(),
      uploadStatus: "ready",
      reporterDomain: "kantor.test",
      ...input,
      workspaceId,
      number: input.number ?? (await claimReportNumber(db, workspaceId)),
      projectId: input.projectId ?? null,
    })
    .returning()
  if (!row) throw new Error("failed to insert report")
  return row
}

/** A null projectId leaves the field out, as an extension sending "No project" does. */
export function uploadBody(projectId: string | null, overrides: Partial<CreateUploadBody> = {}): CreateUploadBody {
  return {
    ...(projectId === null ? {} : { projectId }),
    title: "Checkout button broken",
    captureType: "screenshot",
    mediaSize: 4,
    pageUrl: "https://app.kantor.test/checkout",
    device: { browser: "Chrome 140", os: "Windows 11", viewport: "1440x900" },
    debuggerSummary: { logs: 3, errors: 1, requests: 5, failedRequests: 1, actions: 4, incomplete: [] },
    ...overrides,
  }
}

/** `target` is null only for media sent in parts, which local storage never asks for. */
export function putUpload(
  app: { handle(request: Request): Promise<Response> },
  target: UploadTarget | null,
  body: Uint8Array<ArrayBuffer>,
) {
  if (!target) throw new Error("expected a single upload link")
  return app.handle(new Request(target.url, { method: target.method, headers: target.headers, body }))
}

export interface FakeTrackers {
  factory: TrackerFactory
  created: Array<{ provider: TrackerProvider; config: TrackerConfig; secret: string; content: IssueContent }>
  tests: Array<{ provider: TrackerProvider; config: TrackerConfig; secret: string }>
  behaviour: { test?: () => Promise<void>; createIssue?: (content: IssueContent) => Promise<CreatedIssue> }
}

/** A tracker that records calls instead of touching the network. */
export function fakeTrackers(): FakeTrackers {
  const fake: FakeTrackers = {
    created: [],
    tests: [],
    behaviour: {},
    factory: (provider, config, secret) => ({
      async test() {
        fake.tests.push({ provider, config, secret })
        await fake.behaviour.test?.()
      },
      async createIssue(content) {
        fake.created.push({ provider, config, secret, content })
        if (fake.behaviour.createIssue) return fake.behaviour.createIssue(content)
        const number = fake.created.length
        return { externalId: String(number), url: `https://tracker.test/issues/${number}` }
      },
    }),
  }
  return fake
}

/**
 * A workspace connection and its use in a project, written straight to the database. Pass `connectionId` to add another
 * use of an existing connection. The secret is sealed with TEST_ENCRYPTION_KEY.
 */
export async function createIntegration(
  db: Db,
  input: {
    projectId: string
    provider: IntegrationProvider
    target?: UseTarget
    settings?: ConnectionSettings
    secret?: string
    name?: string
    autoSend?: boolean
    connectionId?: string
  },
): Promise<{ id: string; connectionId: string }> {
  let connectionId = input.connectionId
  if (!connectionId) {
    const [owner] = await db.select({ workspaceId: project.workspaceId }).from(project).where(sql`${project.id} = ${input.projectId}`)
    if (!owner) throw new Error("no such project")
    connectionId = newId()
    await db.insert(connection).values({
      id: connectionId,
      workspaceId: owner.workspaceId,
      provider: input.provider,
      name: input.name ?? input.provider,
      settings: input.settings ?? {},
      secretEncrypted: createSecretBox(TEST_ENCRYPTION_KEY).seal(input.secret ?? "secret"),
    })
  }
  const target = input.target ?? {}
  const id = newId()
  await db.insert(integration).values({
    id,
    projectId: input.projectId,
    connectionId,
    provider: input.provider,
    config: target,
    targetKey: targetKey(input.provider, target),
    autoSend: input.autoSend ?? false,
  })
  return { id, connectionId }
}

/** Polls until `check` returns a value, for work the server does in the background. */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error("waitFor timed out")
    await Bun.sleep(20)
  }
}
