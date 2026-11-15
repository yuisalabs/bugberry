import { afterAll, beforeAll, expect, test } from "bun:test"
import { SQL } from "bun"
import { TEST_DATABASE_URL } from "./helpers"

/**
 * Migration 0037 adds a generated column over rows that already exist, so it is checked on a database built from the
 * migrations before it and holding reports in both shapes `debugger_summary` is stored in.
 */
const SCRATCH = "fdebag_migration_0037"
const drizzleDir = new URL("../drizzle/", import.meta.url)
const admin = new SQL(TEST_DATABASE_URL)
let scratch: SQL

async function apply(db: SQL, tag: string) {
  const text = await Bun.file(new URL(`${tag}.sql`, drizzleDir)).text()
  for (const statement of text.split("--> statement-breakpoint")) {
    if (statement.trim()) await db.unsafe(statement)
  }
}

beforeAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${SCRATCH}`)
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = `/${SCRATCH}`
  scratch = new SQL(url.href)
  const journal = (await Bun.file(new URL("meta/_journal.json", drizzleDir)).json()) as { entries: Array<{ idx: number; tag: string }> }
  for (const entry of journal.entries.filter((item) => item.idx <= 36)) await apply(scratch, entry.tag)
}, 60_000)

afterAll(async () => {
  await scratch?.close()
  await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`)
  await admin.close()
}, 30_000)

const summary = (errors: number, failedRequests: number) =>
  JSON.stringify({ logs: 0, errors, requests: 0, failedRequests, actions: 0, incomplete: [] })

test("migration 0037 adds has_errors for both stored shapes and swaps the indexes", async () => {
  await scratch.unsafe(`
    INSERT INTO workspace (id, name) VALUES ('w1', 'Kantor');
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'Dana', 'dana@kantor.test');
  `)
  const insert = (id: string, number: number, debuggerSummary: string) =>
    scratch.unsafe(
      `INSERT INTO report (id, workspace_id, reporter_id, number, title, share_slug, capture_type, page_url, device,
         media_key, media_type, media_size, debugger_summary, upload_status)
       VALUES ($1, 'w1', 'u1', $2, 'Pay fails', $1, 'screenshot', 'https://shop.kantor.test',
         '{"browser":"Chrome","os":"Mac","viewport":"1x1"}', 'k', 'image/png', 3, ${debuggerSummary}, 'ready')`,
      [id, number],
    )
  // The driver writes the summary as a JSON string inside jsonb; a row written by hand holds the object itself.
  await insert("r1", 1, `to_jsonb('${summary(2, 0)}'::text)`)
  await insert("r2", 2, `'${summary(0, 1)}'::jsonb`)
  await insert("r3", 3, `to_jsonb('${summary(0, 0)}'::text)`)
  await scratch.unsafe(`INSERT INTO comment (id, report_id, author_id, body) VALUES ('c1', 'r1', 'u1', 'Still broken')`)

  await apply(scratch, "0037_report_list_indexes")

  const rows = await scratch.unsafe(`SELECT id, has_errors FROM report ORDER BY id`)
  expect(rows.map((row: { id: string; has_errors: boolean }) => ({ id: row.id, has_errors: row.has_errors }))).toEqual([
    { id: "r1", has_errors: true },
    { id: "r2", has_errors: true },
    { id: "r3", has_errors: false },
  ])

  const indexes = await scratch.unsafe(`SELECT indexname FROM pg_indexes WHERE tablename IN ('report', 'comment')`)
  const names = indexes.map((row: { indexname: string }) => row.indexname)
  expect(names).toContain("report_workspace_created_id_idx")
  expect(names).toContain("comment_body_trgm_idx")
  expect(names).not.toContain("report_status_idx")
  expect(names).not.toContain("report_workspace_created_idx")
  expect(await scratch.unsafe(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)).toHaveLength(1)

  // A report saved after the upgrade gets the column too.
  await insert("r4", 4, `to_jsonb('${summary(0, 3)}'::text)`)
  const [added] = await scratch.unsafe(`SELECT has_errors FROM report WHERE id = 'r4'`)
  expect(added.has_errors).toBe(true)
})
