import { beforeEach, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createReadyReport, createUserWithToken, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let reporterId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  reporterId = (await createUserWithToken(ctx.db)).user.id
  await ctx.db.execute(sql`INSERT INTO workspace (id, name) VALUES ('other-ws', 'Other')`)
})

const insertLabel = async (id: string, workspaceId: string, name: string) => {
  await ctx.db.execute(sql`INSERT INTO label (id, workspace_id, name) VALUES (${id}, ${workspaceId}, ${name})`)
}
const links = async () => (await ctx.db.execute(sql`SELECT report_id, label_id FROM report_label`)) as unknown as unknown[]

test("label names are unique in a workspace whatever their case", async () => {
  await insertLabel("l1", ctx.workspace.id, "Bug")
  await expect(insertLabel("l2", ctx.workspace.id, "bug")).rejects.toThrow()
  await insertLabel("l3", "other-ws", "bug")
})

test("a new label is gray", async () => {
  await insertLabel("l1", ctx.workspace.id, "Bug")
  const [row] = (await ctx.db.execute(sql`SELECT color FROM label WHERE id = 'l1'`)) as unknown as Array<{ color: string }>
  expect(row?.color).toBe("gray")
})

test("deleting a label or a report removes the link", async () => {
  const first = await createReadyReport(ctx.db, { reporterId })
  const second = await createReadyReport(ctx.db, { reporterId })
  await insertLabel("l1", ctx.workspace.id, "Bug")
  await insertLabel("l2", ctx.workspace.id, "Checkout")
  await ctx.db.execute(sql`INSERT INTO report_label (report_id, label_id) VALUES (${first.id}, 'l1'), (${second.id}, 'l2')`)
  await ctx.db.execute(sql`DELETE FROM label WHERE id = 'l1'`)
  expect(await links()).toHaveLength(1)
  await ctx.db.execute(sql`DELETE FROM report WHERE id = ${second.id}`)
  expect(await links()).toHaveLength(0)
})

test("the activity kind enum knows labels", async () => {
  const rows = (await ctx.db.execute(sql`SELECT unnest(enum_range(null::activity_kind))::text AS kind`)) as unknown as Array<{ kind: string }>
  expect(rows.map((row) => row.kind)).toContain("labels")
})
