import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import { issueExtensionToken } from "../src/admin/issue-token"
import { createApp } from "../src/app"
import { createAuth } from "../src/auth/better-auth"
import type { Config } from "../src/config"
import { createDb } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"
import { project } from "../src/db/schema"
import { newId } from "../src/lib/ids"
import { createWorkspace } from "../src/workspaces/provision"
import { serveOptions } from "../src/server-options"
import { withDashboard } from "./e2e-dashboard"
import { createStorage } from "../src/storage"

/** A dashboard sign-in for the E2E user, as the browser would hold it after logging in. */
async function signedSessionCookie(userId: string): Promise<{ name: string; value: string }> {
  const context = await betterAuth.$context
  const session = await context.internalAdapter.createSession(userId)
  // Better Auth signs the cookie as `${token}.${base64(HMAC-SHA256(token, secret))}`, URI-encoded.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config.authSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(session.token))).toString("base64")
  return { name: context.authCookies.sessionToken.name, value: encodeURIComponent(`${session.token}.${signature}`) }
}

/** Boots the API against the test database plus a demo page, for the extension smoke test. */
const port = Number(process.env.E2E_PORT ?? 3999)
const demoPort = Number(process.env.E2E_DEMO_PORT ?? 4400)
const statePath = process.env.E2E_STATE_FILE
if (!statePath) throw new Error("E2E_STATE_FILE is required")

const config: Config = {
  port,
  appUrl: `http://127.0.0.1:${port}`,
  databaseUrl: process.env.TEST_DATABASE_URL ?? "postgres://fdebag:fdebag@localhost:54329/fdebag_test",
  authSecret: "e2e-secret-e2e-secret-e2e-secret-000000",
  google: { clientId: "e2e", clientSecret: "e2e" },
  github: null,
  gitlab: null,
  email: { driver: "log", from: "BugBerry <no-reply@e2e>" },
  allowedEmailDomains: ["kantor.test"],
  extensionId: null,
  extensionInstallUrl: null,
  maxUploadBytes: 50 * 1024 * 1024,
  uploadUrlTtlSeconds: 3600,
  readUrlTtlSeconds: 3600,
  proxyHops: 0,
  encryptionKey: Buffer.alloc(32, 3).toString("base64"),
  storage: { driver: "local", dir: mkdtempSync(join(tmpdir(), "bugberry-e2e-")) },
  accountLimits: null,
}

const db = createDb(config.databaseUrl)
await runMigrations(db)
await db.execute(sql.raw(`TRUNCATE TABLE "workspace_invitation", "workspace_member", "workspace", "report_external_link", "integration", "comment", "report", "project", "api_token", "session", "account", "verification", "user" CASCADE`))
const { token, userId } = await issueExtensionToken(db, config, { email: "e2e@kantor.test", name: "E2E" })
// The E2E user works in "Demo", which holds the demo page's project.
const demoWorkspace = await createWorkspace(db, userId, "Demo")
await db
  .insert(project)
  .values({ id: newId(), workspaceId: demoWorkspace.id, name: "Demo", slug: "demo", urlPatterns: [`127.0.0.1:${demoPort}`] })
const betterAuth = createAuth(config, db)
const sessionCookie = await signedSessionCookie(userId)
// Same company domain, own workspace: may read the E2E user's "internal" reports, nothing else.
const colleague = await issueExtensionToken(db, config, { email: "colleague@kantor.test", name: "Colleague" })
const colleagueCookie = await signedSessionCookie(colleague.userId)

const api = createApp({ config, db, storage: createStorage(config), betterAuth })
withDashboard(api, fileURLToPath(new URL("../../client/dist", import.meta.url))).listen(serveOptions(config))

const DEMO_PAGE = `<!doctype html><html><head><title>Demo checkout</title></head><body>
<button id="pay">Bayar</button>
<img src="/logo.png" alt="">
<script src="/demo.js"></script></body></html>`

// Its own file, so the console call has a call site ("demo.js:2") and the script shows in the Network tab.
const DEMO_SCRIPT = `document.getElementById("pay").addEventListener("click", () => {
  console.error("checkout failed")
  fetch("/api/price").catch(() => {})
})
`
/** A 1x1 transparent PNG. */
const DEMO_LOGO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)

Bun.serve({
  port: demoPort,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/api/price") return Response.json({ error: "boom" }, { status: 500 })
    if (path === "/demo.js") return new Response(DEMO_SCRIPT, { headers: { "content-type": "text/javascript" } })
    if (path === "/logo.png") return new Response(DEMO_LOGO, { headers: { "content-type": "image/png" } })
    return new Response(DEMO_PAGE, { headers: { "content-type": "text/html" } })
  },
})

writeFileSync(statePath, JSON.stringify({ serverUrl: config.appUrl, token, sessionCookie, colleagueCookie, demoUrl: `http://127.0.0.1:${demoPort}/` }))
console.info(`e2e server ready on ${config.appUrl}`)
