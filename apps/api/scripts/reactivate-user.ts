import { parseArgs } from "node:util"
import { reactivateUser } from "../src/admin/deactivate-user"
import { loadConfig } from "../src/config"
import { createDb } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"

const { values } = parseArgs({ options: { email: { type: "string" } } })

if (!values.email) {
  console.error("Usage: bun run account:reactivate --email you@kantor.com")
  process.exit(1)
}

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
await runMigrations(db)
try {
  const result = await reactivateUser(db, values.email)
  console.info(
    result.wasDeactivated ? `${result.email} can sign in again. Revoked tokens stay revoked.` : `${result.email} was not deactivated.`,
  )
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
