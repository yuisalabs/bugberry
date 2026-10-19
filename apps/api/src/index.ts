import { createApp } from "./app"
import { createAuth } from "./auth/better-auth"
import { loadConfig } from "./config"
import { createDb } from "./db/client"
import { runMigrations } from "./db/migrate"
import { cleanupStaleUploads, startCleanupSchedule } from "./jobs/cleanup"
import { installShutdown } from "./lib/shutdown"
import { clientIpSource } from "./modules/share"
import { serveOptions } from "./server-options"
import { createStorage } from "./storage"

const HOUR_MS = 60 * 60 * 1000
const STALE_UPLOAD_AGE_MS = 24 * HOUR_MS

const config = loadConfig(process.env)
if (process.env.ADMIN_EMAILS?.trim()) {
  console.warn("ADMIN_EMAILS is no longer used: admins are set per workspace on its Members page")
}
const db = createDb(config.databaseUrl)
await runMigrations(db)

const storage = createStorage(config)
const betterAuth = createAuth(config, db)
const app = createApp({ config, db, storage, betterAuth }).listen(serveOptions(config))

const runCleanup = () =>
  cleanupStaleUploads({ db, storage }, new Date(Date.now() - STALE_UPLOAD_AGE_MS))
    .then((removed) => removed > 0 && console.info(`cleanup: removed ${removed} stale uploads`))
    .catch((error) => console.error("cleanup failed", error))
const stopCleanup = startCleanupSchedule(runCleanup, HOUR_MS)

installShutdown(process, async () => {
  stopCleanup()
  await app.stop()
  await db.$client.close()
})

console.info(`BugBerry server listening on port ${app.server?.port}; ${clientIpSource(config.proxyHops)}`)
