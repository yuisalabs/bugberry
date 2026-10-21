import { afterAll, beforeAll, expect, test } from "bun:test"
import { SQL } from "bun"
import { TEST_DATABASE_URL } from "./helpers"

/**
 * Migration 0022 moves data, so it is checked on a database built from the migrations before it, holding rows in their
 * old shape. The scratch database lives next to the test database and is dropped afterwards.
 */
const SCRATCH = "fdebag_migration_0022"
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
  for (const entry of journal.entries.filter((item) => item.idx <= 21)) await apply(scratch, entry.tag)
})

afterAll(async () => {
  await scratch?.close()
  await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`)
  await admin.close()
})

test("migration 0022 moves each integration into a connection and keeps links", async () => {
  const sealed = "v1.not.openable.here"
  await scratch.unsafe(`
    INSERT INTO workspace (id, name) VALUES ('w1', 'Kantor');
    INSERT INTO "user" (id, name, email) VALUES ('u1', 'Dana', 'dana@kantor.test');
    INSERT INTO project (id, workspace_id, name, slug) VALUES ('p1', 'w1', 'Checkout Web', 'checkout');
    INSERT INTO report (id, workspace_id, project_id, reporter_id, number, title, share_slug, capture_type, page_url, device,
      media_key, media_type, media_size, debugger_summary, upload_status)
    VALUES ('r1', 'w1', 'p1', 'u1', 1, 'Pay fails', 'share1', 'screenshot', 'https://shop.kantor.test',
      '{"browser":"Chrome","os":"Mac","viewport":"1x1"}', 'k', 'image/png', 3,
      '{"logs":0,"errors":0,"requests":0,"failedRequests":0,"actions":0,"incomplete":[]}', 'ready');
  `)
  await scratch.unsafe(
    `INSERT INTO integration (id, project_id, provider, config, secret_encrypted, auto_send) VALUES
      ('gh', 'p1', 'github', '{"owner":"kantor","repo":"web","labels":["bug"]}', $1, true),
      ('ji', 'p1', 'jira', '{"siteUrl":"https://kantor.atlassian.net","email":"dana@kantor.test","projectKey":"BUG","issueType":"Bug","labels":[]}', $1, false),
      ('wh', 'p1', 'webhook', '{"url":"https://hooks.kantor.test/x"}', $1, false)`,
    [sealed],
  )
  await scratch.unsafe(
    `INSERT INTO report_external_link (id, report_id, integration_id, external_id, external_url)
     VALUES ('l1', 'r1', 'gh', '42', 'https://github.com/kantor/web/issues/42')`,
  )

  await apply(scratch, "0022_workspace_connections")

  const connections = await scratch.unsafe(`SELECT * FROM connection ORDER BY id`)
  expect(connections.map((row: { id: string }) => row.id)).toEqual(["gh", "ji", "wh"])
  for (const row of connections) expect(row).toMatchObject({ workspace_id: "w1", secret_encrypted: sealed })
  const byId = Object.fromEntries(connections.map((row: { id: string }) => [row.id, row]))
  expect(byId.gh).toMatchObject({ provider: "github", name: "GitHub · kantor/web", settings: {} })
  expect(byId.ji).toMatchObject({ name: "Jira · BUG", settings: { siteUrl: "https://kantor.atlassian.net", email: "dana@kantor.test" } })
  expect(byId.wh).toMatchObject({ name: "Webhook · hooks.kantor.test", settings: { url: "https://hooks.kantor.test/x" } })

  const uses = await scratch.unsafe(`SELECT * FROM integration ORDER BY id`)
  for (const row of uses) expect(row.connection_id).toBe(row.id)
  const useById = Object.fromEntries(uses.map((row: { id: string }) => [row.id, row]))
  expect(useById.ji.config).toEqual({ projectKey: "BUG", issueType: "Bug", labels: [] })
  expect(useById.gh).toMatchObject({ config: { owner: "kantor", repo: "web", labels: ["bug"] }, auto_send: true })
  expect(useById.wh.config).toEqual({})
  expect("secret_encrypted" in useById.gh).toBe(false)

  const [link] = await scratch.unsafe(`SELECT * FROM report_external_link WHERE id = 'l1'`)
  expect(link).toMatchObject({ provider: "github", integration_id: "gh", external_id: "42" })

  await scratch.unsafe(`DELETE FROM connection WHERE id = 'gh'`)
  expect(await scratch.unsafe(`SELECT id FROM integration WHERE id = 'gh'`)).toHaveLength(0)
  const [kept] = await scratch.unsafe(`SELECT * FROM report_external_link WHERE id = 'l1'`)
  expect(kept).toMatchObject({ provider: "github", integration_id: null, external_id: "42" })
})
