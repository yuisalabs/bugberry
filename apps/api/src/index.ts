import { createApp, createMcpApp } from "./app"
import { createAuth } from "./modules/auth/better-auth"
import { accountLimitsNotice, loadConfig } from "./config"
import { createDb } from "./db/client"
import { runMigrations } from "./db/migrate"
import { cleanupStaleUploads, startCleanupSchedule } from "./jobs/cleanup"
import { installShutdown } from "./lib/shutdown"
import { clientIpSource } from "./modules/share"
import { serveOptions } from "./server-options"
import { createStorage } from "./storage"
import { deleteOldRateLimitHits } from "./lib/shared-rate-limit"
import { configurePayloadWorkers, stopPayloadWorkers } from "./workers/payloads"

const HOUR_MS = 60 * 60 * 1000
const STALE_UPLOAD_AGE_MS = 24 * HOUR_MS

const config = loadConfig(process.env)
if (process.env.ADMIN_EMAILS?.trim()) {
  console.warn("ADMIN_EMAILS is no longer used: admins are set per workspace on its Members page")
}
const role = config.serverRole
configurePayloadWorkers(config.payloadWorkers)

// Two pools, so agents that use up MCP's connections never make the dashboard wait for one. A process that serves
// only MCP opens only MCP's, and one that serves no MCP only the dashboard's.
const mcpPool = { max: config.mcp.dbPoolMax, statementTimeoutMs: config.mcp.statementTimeoutMs }
const db = createDb(config.databaseUrl, role === "mcp" ? mcpPool : { max: config.dbPoolMax })
const mcpDb = role === "all" ? createDb(config.databaseUrl, mcpPool) : undefined

// The app process migrates and cleans up; an MCP container starts after it (compose waits for the api's health).
if (role !== "mcp") await runMigrations(db)

const storage = createStorage(config)
const betterAuth = createAuth(config, db)
const deps = { config, db, mcpDb, storage, betterAuth }
const app = (role === "mcp" ? createMcpApp(deps) : createApp(deps)).listen(serveOptions(config))

const runCleanup = () =>
  cleanupStaleUploads({ db, storage }, new Date(Date.now() - STALE_UPLOAD_AGE_MS))
    .then((removed) => removed > 0 && console.info(`cleanup: removed ${removed} stale uploads`))
    .then(() => deleteOldRateLimitHits(db, new Date(Date.now() - HOUR_MS)))
    .catch((error) => console.error("cleanup failed", error))
const stopCleanup = role === "mcp" ? () => {} : startCleanupSchedule(runCleanup, HOUR_MS)

installShutdown(process, async () => {
  stopCleanup()
  await app.stop()
  stopPayloadWorkers()
  await db.$client.close()
  await mcpDb?.$client.close()
})

console.info(`BugBerry server (${role}) listening on port ${app.server?.port}; ${clientIpSource(config.proxyHops)}`)
const limitsNotice = accountLimitsNotice(config.accountLimits)
if (limitsNotice) console.info(limitsNotice)
