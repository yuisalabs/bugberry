import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SQL } from "bun"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sql"
import { migrate } from "drizzle-orm/bun-sql/migrator"
import { MIGRATIONS_FOLDER } from "../src/db/migrate"
import { report } from "../src/db/schema"
import { TEST_DATABASE_URL, createUserWithToken, createWorkspaceRow, setupTestApp, uploadBody } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

async function numberOf(id: string) {
  const [row] = await ctx.db.select({ number: report.number }).from(report).where(eq(report.id, id))
  return row?.number
}

describe("report numbers", () => {
  test("new reports are numbered per workspace, starting at 1", async () => {
    const me = await createUserWithToken(ctx.db)
    const other = await createWorkspaceRow(ctx.db, "Other")
    const them = await createUserWithToken(ctx.db, { workspaceId: other.id })
    const upload = async (who: typeof me) => {
      const { data } = await ctx.api.api.reports.uploads.post(uploadBody(null), { headers: who.headers })
      return numberOf(data?.reportId ?? "")
    }
    expect(await upload(me)).toBe(1)
    expect(await upload(me)).toBe(2)
    expect(await upload(them)).toBe(1)
    expect(await upload(me)).toBe(3)

    const first = await ctx.api.api.reports.uploads.post(uploadBody(null), { headers: me.headers })
    const { data: detail } = await ctx.api.api.reports({ id: first.data?.reportId ?? "" }).get({ headers: me.headers })
    expect(detail?.number).toBe(4)
  })

  test("concurrent uploads get distinct numbers", async () => {
    const me = await createUserWithToken(ctx.db)
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ctx.api.api.reports.uploads.post(uploadBody(null), { headers: me.headers })),
    )
    const numbers = await Promise.all(results.map((result) => numberOf(result.data?.reportId ?? "")))
    expect(numbers.sort()).toEqual([1, 2, 3, 4, 5])
  })
})

const DB_NAME = "fdebag_numbers_migration_test"
const admin = new SQL(TEST_DATABASE_URL)
const url = new URL(TEST_DATABASE_URL)
url.pathname = `/${DB_NAME}`
const scratch = mkdtempSync(join(tmpdir(), "bugberry-numbers-"))

/** The migrations folder without report numbers: entries up to 0007 only. */
function migrationsUpTo(lastIndex: number): string {
  const folder = join(scratch, `upto-${lastIndex}`)
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true })
  const journalPath = join(folder, "meta", "_journal.json")
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> }
  journal.entries = journal.entries.filter((entry) => entry.idx <= lastIndex)
  writeFileSync(journalPath, JSON.stringify(journal))
  return folder
}

afterAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)
  await admin.close()
  rmSync(scratch, { recursive: true, force: true })
}, 60_000)

describe("report numbers migration", () => {
  test("the migration numbers existing reports in creation order", async () => {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`)
    const client = new SQL(url.href)
    const db = drizzle({ client })
    await migrate(db, { migrationsFolder: migrationsUpTo(7) })

    await client.unsafe(`
      INSERT INTO workspace (id, name) VALUES ('w1', 'One'), ('w2', 'Two'), ('w3', 'Empty');
      INSERT INTO "user" (id, name, email, email_verified) VALUES ('u1', 'Ana', 'ana@kantor.com', true);
      INSERT INTO report (id, workspace_id, reporter_id, title, share_slug, capture_type, page_url, device, media_key,
        media_type, media_size, debugger_summary, upload_status, created_at) VALUES
        ('r-late', 'w1', 'u1', 'Late', 's1', 'screenshot', 'https://a.test', '{}', 'k1', 'image/png', 1, '{}', 'ready', '2026-03-01'),
        ('r-early', 'w1', 'u1', 'Early', 's2', 'screenshot', 'https://a.test', '{}', 'k2', 'image/png', 1, '{}', 'ready', '2026-01-01'),
        ('r-b', 'w1', 'u1', 'Tie b', 's3', 'screenshot', 'https://a.test', '{}', 'k3', 'image/png', 1, '{}', 'ready', '2026-02-01'),
        ('r-a', 'w1', 'u1', 'Tie a', 's4', 'screenshot', 'https://a.test', '{}', 'k4', 'image/png', 1, '{}', 'ready', '2026-02-01'),
        ('r-other', 'w2', 'u1', 'Other', 's5', 'screenshot', 'https://a.test', '{}', 'k5', 'image/png', 1, '{}', 'ready', '2026-05-01');
    `)

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

    const reports = await client.unsafe(`SELECT id, number FROM report ORDER BY workspace_id, number`)
    expect(reports.map((row: { id: string; number: number }) => [row.id, row.number])).toEqual([
      ["r-early", 1],
      ["r-a", 2],
      ["r-b", 3],
      ["r-late", 4],
      ["r-other", 1],
    ])
    const workspaces = await client.unsafe(`SELECT id, next_report_number FROM workspace ORDER BY id`)
    expect(workspaces.map((row: { id: string; next_report_number: number }) => [row.id, row.next_report_number])).toEqual([
      ["w1", 5],
      ["w2", 2],
      ["w3", 1],
    ])
    await client.close()
    // Builds a database from nothing; slow when the whole suite shares the server.
  }, 60_000)
})
