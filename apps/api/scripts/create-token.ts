import { parseArgs } from "node:util"
import { issueExtensionToken } from "../src/admin/issue-token"
import { loadConfig } from "../src/config"
import { createDb } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    label: { type: "string" },
  },
})

if (!values.email) {
  console.error('Usage: bun run token:create --email you@kantor.com [--name "Ana"] [--label "Bot"]')
  process.exit(1)
}

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
await runMigrations(db)
const issued = await issueExtensionToken(db, config, {
  email: values.email,
  name: values.name,
  label: values.label,
})
console.info(`${issued.createdUser ? "Created" : "Found"} user ${issued.email}`)
console.info(`Token (shown once; send it as "Authorization: Bearer <token>"): ${issued.token}`)
process.exit(0)
