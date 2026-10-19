import { afterAll, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"
import { migrate } from "drizzle-orm/bun-sql/migrator"
import { MIGRATIONS_FOLDER } from "../src/db/migrate"
import { TEST_DATABASE_URL } from "./helpers"

const DB_NAME = "fdebag_migration_test"
const admin = new SQL(TEST_DATABASE_URL)
const url = new URL(TEST_DATABASE_URL)
url.pathname = `/${DB_NAME}`
const scratch = mkdtempSync(join(tmpdir(), "bugberry-migrations-"))

/** The migrations folder as it was before workspaces: entries up to 0004 only. */
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

describe("workspaces migration", () => {
  test("legacy data moves into one workspace", async () => {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`)
    const client = new SQL(url.href)
    const db = drizzle({ client })
    await migrate(db, { migrationsFolder: migrationsUpTo(4) })

    await client.unsafe(`
      INSERT INTO "user" (id, name, email, email_verified, role) VALUES
        ('u1', 'Ana', 'ana@kantor.com', true, 'admin'),
        ('u2', 'Budi', 'budi@kantor.com', true, 'member'),
        ('u3', 'Cici', 'cici@gmail.com', true, 'member');
      INSERT INTO project (id, name, slug) VALUES ('p1', 'Web', 'web');
      INSERT INTO report (id, project_id, reporter_id, title, visibility, share_slug, capture_type, page_url,
        device, media_key, media_type, media_size, debugger_summary, upload_status) VALUES
        ('r1', 'p1', 'u2', 'Internal one', 'internal', 'slug1', 'screenshot', 'https://a.test', '{}', 'k1', 'image/png', 1, '{}', 'ready'),
        ('r2', NULL, 'u3', 'Public one', 'public', 'slug2', 'screenshot', 'https://a.test', '{}', 'k2', 'image/png', 1, '{}', 'ready');
    `)

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

    const workspaces = await client.unsafe(`SELECT id, name FROM workspace`)
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].name).toBe("kantor.com")
    const workspaceId = workspaces[0].id as string

    const members = await client.unsafe(`SELECT user_id, role FROM workspace_member WHERE workspace_id = $1 ORDER BY user_id`, [
      workspaceId,
    ])
    expect(members.map((row: { user_id: string; role: string }) => [row.user_id, row.role])).toEqual([
      ["u1", "admin"],
      ["u2", "member"],
      ["u3", "member"],
    ])
    const users = await client.unsafe(`SELECT id, last_workspace_id FROM "user" ORDER BY id`)
    expect(users.every((row: { last_workspace_id: string }) => row.last_workspace_id === workspaceId)).toBe(true)

    expect((await client.unsafe(`SELECT workspace_id FROM project`))[0].workspace_id).toBe(workspaceId)
    const reports = await client.unsafe(`SELECT id, workspace_id, visibility, reporter_domain FROM report ORDER BY id`)
    expect(reports.map((row: Record<string, string>) => [row.id, row.workspace_id, row.visibility, row.reporter_domain])).toEqual([
      ["r1", workspaceId, "workspace", "kantor.com"],
      ["r2", workspaceId, "public", "gmail.com"],
    ])
    await client.close()
    // Builds a database from nothing twice; slow when the whole suite shares the server.
  }, 60_000)
})
