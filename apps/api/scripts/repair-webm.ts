/**
 * Repairs video recordings made before the extension stopped using fix-webm-duration, so they play in
 * Safari (see src/storage/webm-repair.ts). Dry run by default; --apply writes the repaired files back.
 * Each file keeps its length; only two size fields in its header change. Safe to run again.
 *
 * In the api container:
 *   docker compose exec api bun apps/api/scripts/repair-webm.ts
 *   docker compose exec api bun apps/api/scripts/repair-webm.ts --apply
 */
import { parseArgs } from "node:util"
import { repairWebmRecordings } from "../src/admin/repair-webm"
import { loadConfig } from "../src/config"
import { createDb } from "../src/db/client"
import { createStorage } from "../src/storage"

const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } })

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
const storage = createStorage(config)

const summary = await repairWebmRecordings({ db, storage }, { apply: values.apply, log: (line) => console.info(line) })

console.info("")
console.info(`Checked ${summary.checked} video recordings:`)
console.info(`  ${summary.alreadyOk} already play everywhere`)
console.info(`  ${summary.needsRepair} need the repair${values.apply ? `, ${summary.repaired} repaired` : " (dry run: run again with --apply)"}`)
if (summary.unrecognized) console.info(`  ${summary.unrecognized} skipped: not a layout this script knows`)
if (summary.missing) console.info(`  ${summary.missing} have no file in storage`)
if (summary.failed) console.info(`  ${summary.failed} failed (see above)`)
process.exit(summary.failed ? 1 : 0)
