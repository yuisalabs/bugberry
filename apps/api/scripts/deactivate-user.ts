import { parseArgs } from "node:util"
import { deactivateUser } from "../src/admin/deactivate-user"
import { loadConfig } from "../src/config"
import { createDb } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"

const { values } = parseArgs({ options: { email: { type: "string" } } })

if (!values.email) {
  console.error("Usage: bun run account:deactivate --email you@kantor.com")
  process.exit(1)
}

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
await runMigrations(db)
try {
  const result = await deactivateUser(db, values.email)
  console.info(
    result.alreadyDeactivated
      ? `${result.email} was already deactivated.`
      : `${result.email} is deactivated. Sessions ended, tokens revoked, AI apps disconnected.`,
  )
  if (result.withoutAdmin.length > 0) {
    console.info("No active admin is left in:")
    for (const workspace of result.withoutAdmin) {
      console.info(`  ${workspace.name}: bun apps/api/scripts/promote-admin.ts --workspace ${workspace.ref} --email <someone>`)
    }
  }
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
