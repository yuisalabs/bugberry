import { beforeEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let outsider: Awaited<ReturnType<typeof createUserWithToken>>
let workspaceId: string

type Who = { headers: Record<string, string> }
const call = (method: string, path: string, who: Who, body?: unknown) =>
  ctx.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...who.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
const json = async (response: Response) => (await response.json()) as any

beforeEach(async () => {
  ctx = await setupTestApp()
  workspaceId = ctx.workspace.id
  member = await createUserWithToken(ctx.db, { role: "member" })
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  const other = await createWorkspaceRow(ctx.db, "Elsewhere")
  outsider = await createUserWithToken(ctx.db, { workspaceId: other.id, role: "admin" })
})

const create = (name: string, who: Who = member, color?: string) => call("POST", "/api/labels", who, { workspaceId, name, ...(color ? { color } : {}) })

describe("labels of a workspace", () => {
  test("a member creates a label and sees it listed with its report count", async () => {
    const created = await json(await create("  Checkout  ", member, "red"))
    expect(created).toMatchObject({ name: "Checkout", color: "red" })
    expect(await json(await call("GET", `/api/labels?workspaceId=${workspaceId}`, member))).toEqual([{ ...created, reportCount: 0 }])
  })

  test("without a workspace the caller's current one is used, sorted by name whatever the case", async () => {
    await create("beta")
    await create("Alpha")
    expect((await json(await call("GET", "/api/labels", member))).map((label: { name: string }) => label.name)).toEqual(["Alpha", "beta"])
  })

  test("a new label is gray unless told otherwise", async () => {
    expect((await json(await create("Bug"))).color).toBe("gray")
  })

  test("an unknown color is refused", async () => {
    expect((await create("Bug", member, "mauve")).status).toBe(422)
  })

  test("the same name in another case is refused", async () => {
    await create("Bug")
    const again = await create("bug")
    expect(again.status).toBe(409)
    expect((await json(again)).code).toBe("label_exists")
  })

  test("two creates of the same name at once make one label", async () => {
    const answers = await Promise.all([create("Bug"), create("bug")])
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409])
  })

  test("an empty, too long or two-line name is refused", async () => {
    for (const name of ["   ", "x".repeat(41), "a\nb"]) {
      const answer = await create(name)
      expect(answer.status).toBe(422)
    }
  })

  test("the 101st label is refused", async () => {
    await ctx.db.execute(
      sql`INSERT INTO label (id, workspace_id, name) SELECT 'seed-' || n, ${workspaceId}, 'Label ' || n FROM generate_series(1, 100) AS n`,
    )
    const over = await create("One more")
    expect(over.status).toBe(422)
    expect((await json(over)).code).toBe("label_limit")
  })

  test("creates at once for the last places never pass 100", async () => {
    await ctx.db.execute(
      sql`INSERT INTO label (id, workspace_id, name) SELECT 'seed-' || n, ${workspaceId}, 'Label ' || n FROM generate_series(1, 99) AS n`,
    )
    const answers = await Promise.all(["A", "B", "C", "D"].map((name) => create(name)))
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 422, 422, 422])
    const [row] = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM label WHERE workspace_id = ${workspaceId}`)) as unknown as Array<{ n: number }>
    expect(row?.n).toBe(100)
  })

  test("a member can't rename or delete; an admin can", async () => {
    const label = await json(await create("Bug"))
    expect((await call("PATCH", `/api/labels/${label.id}`, member, { name: "Defect" })).status).toBe(403)
    expect((await call("DELETE", `/api/labels/${label.id}`, member)).status).toBe(403)
    expect(await json(await call("PATCH", `/api/labels/${label.id}`, admin, { name: "Defect", color: "blue" }))).toMatchObject({ name: "Defect", color: "blue" })
    expect((await call("DELETE", `/api/labels/${label.id}`, admin)).status).toBe(200)
    expect(await json(await call("GET", "/api/labels", member))).toEqual([])
  })

  test("renaming to a name another label has is refused", async () => {
    await create("Bug")
    const other = await json(await create("Checkout"))
    const answer = await call("PATCH", `/api/labels/${other.id}`, admin, { name: "BUG" })
    expect(answer.status).toBe(409)
  })

  test("an outsider gets 404 for the list's workspace and for a label by id", async () => {
    const label = await json(await create("Bug"))
    expect((await call("GET", `/api/labels?workspaceId=${workspaceId}`, outsider)).status).toBe(404)
    expect((await call("POST", "/api/labels", outsider, { workspaceId, name: "Mine" })).status).toBe(404)
    for (const [method, body] of [["PATCH", { name: "x" }], ["DELETE", undefined]] as const) {
      const answer = await call(method, `/api/labels/${label.id}`, outsider, body)
      expect(answer.status).toBe(404)
      expect((await json(answer)).code).toBe("label_not_found")
    }
  })

  test("deleting a label takes it off its reports", async () => {
    const label = await json(await create("Bug"))
    const report = await createReadyReport(ctx.db, { reporterId: member.user.id })
    await ctx.db.execute(sql`INSERT INTO report_label (report_id, label_id) VALUES (${report.id}, ${label.id})`)
    expect((await json(await call("GET", "/api/labels", member)))[0].reportCount).toBe(1)
    await call("DELETE", `/api/labels/${label.id}`, admin)
    const [row] = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM report_label`)) as unknown as Array<{ n: number }>
    expect(row?.n).toBe(0)
  })
})
