import { beforeEach, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createProject, createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let makerId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  makerId = (await createUserWithToken(ctx.db)).user.id
})

const insertRequest = async (id: string, projectId: string | null) => {
  await ctx.db.execute(
    sql`INSERT INTO recording_request (id, workspace_id, project_id, created_by_id, token_hash, max_uses, expires_at)
        VALUES (${id}, ${ctx.workspace.id}, ${projectId}, ${makerId}, ${`hash-${id}`}, 5, now() + interval '7 days')`,
  )
}
const count = async (table: string) => {
  const [row] = (await ctx.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as unknown as Array<{ n: number }>
  return row?.n
}

test("a report keeps its sender when its request is deleted", async () => {
  await insertRequest("q1", null)
  const sent = await createReadyReport(ctx.db, { reporterId: makerId })
  await ctx.db.execute(sql`UPDATE report SET recording_request_id = 'q1', sender_name = 'Budi', sender_email = 'budi@client.test' WHERE id = ${sent.id}`)
  await ctx.db.execute(sql`DELETE FROM recording_request WHERE id = 'q1'`)
  const [row] = (await ctx.db.execute(sql`SELECT recording_request_id, sender_name, sender_email FROM report WHERE id = ${sent.id}`)) as unknown as Array<
    Record<string, string | null>
  >
  expect(row).toEqual({ recording_request_id: null, sender_name: "Budi", sender_email: "budi@client.test" })
})

test("deleting a project removes its request links", async () => {
  const p = await createProject(ctx.db, { name: "Storefront" })
  await insertRequest("q1", p.id)
  await insertRequest("q2", null)
  await ctx.db.execute(sql`DELETE FROM project WHERE id = ${p.id}`)
  expect(await count("recording_request")).toBe(1)
})

test("a new link has an empty note and no page", async () => {
  await insertRequest("q1", null)
  const [row] = (await ctx.db.execute(sql`SELECT note, page_url, revoked_at FROM recording_request`)) as unknown as Array<Record<string, unknown>>
  expect(row).toEqual({ note: "", page_url: null, revoked_at: null })
})

test("the notification kinds know recording_received", async () => {
  const [row] = (await ctx.db.execute(sql`SELECT 'recording_received'::notification_kind AS kind`)) as unknown as Array<{ kind: string }>
  expect(row?.kind).toBe("recording_received")
})
