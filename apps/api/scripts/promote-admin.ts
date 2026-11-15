import { parseArgs } from "node:util"
import { promoteAdmin } from "../src/admin/promote-admin"
import { loadConfig } from "../src/config"
import { createDb } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"

const { values } = parseArgs({ options: { workspace: { type: "string" }, email: { type: "string" } } })

if (!values.workspace || !values.email) {
  console.error("Usage: bun run workspace:promote-admin --workspace acme --email you@kantor.com")
  process.exit(1)
}

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
await runMigrations(db)
try {
  const result = await promoteAdmin(db, values.workspace, values.email)
  console.info(`${result.email} is now an admin of ${result.workspace}.`)
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
