/**
 * Makes small previews for screenshots sent before the extension uploaded one, so the report list stops
 * loading the full screenshot on every card (see src/admin/backfill-thumbnails.ts). Dry run by default;
 * --apply writes the previews. Safe to run again.
 *
 * In the api container:
 *   docker compose exec api bun apps/api/scripts/backfill-thumbnails.ts
 *   docker compose exec api bun apps/api/scripts/backfill-thumbnails.ts --apply
 */
import { parseArgs } from "node:util"
import { backfillThumbnails } from "../src/admin/backfill-thumbnails"
import { loadConfig } from "../src/config"
import { createDb } from "../src/db/client"
import { createStorage } from "../src/storage"

const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } })

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
const storage = createStorage(config)

const summary = await backfillThumbnails({ db, storage }, { apply: values.apply, log: (line) => console.info(line) })

console.info("")
console.info(`Found ${summary.checked} ${summary.checked === 1 ? "screenshot" : "screenshots"} without a preview:`)
if (values.apply) console.info(`  ${summary.created} ${summary.created === 1 ? "preview" : "previews"} added`)
else if (summary.checked) console.info("  dry run: run again with --apply to add their previews")
if (summary.missing) console.info(`  ${summary.missing} have no file in storage`)
if (summary.tooLarge) console.info(`  ${summary.tooLarge} skipped: the preview came out larger than 1 MB`)
if (summary.failed) console.info(`  ${summary.failed} failed (see above)`)
process.exit(summary.failed ? 1 : 0)
