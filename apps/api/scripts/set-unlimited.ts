import { parseArgs } from "node:util"
import { setUnlimited } from "../src/admin/set-unlimited"
import { loadConfig } from "../src/config"
import { createDb } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    on: { type: "boolean" },
    off: { type: "boolean" },
  },
})

if (!values.email || values.on === values.off) {
  console.error("Usage: bun run account:unlimited --email you@kantor.com (--on | --off)")
  process.exit(1)
}

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
await runMigrations(db)
try {
  const result = await setUnlimited(db, values.email, values.on === true)
  console.info(`${result.email} is now ${result.unlimited ? "unlimited" : "limited"}`)
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
