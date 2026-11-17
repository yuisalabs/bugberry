import { beforeEach, describe, expect, test } from "bun:test"
import { createReadyReport, createUserWithToken, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let member: Awaited<ReturnType<typeof createUserWithToken>>
let outsider: Awaited<ReturnType<typeof createUserWithToken>>
let reportId: string
let bug: { id: string }
let checkout: { id: string }
let foreign: { id: string }

type Who = { headers: Record<string, string> }
const call = (method: string, path: string, who: Who | null, body?: unknown) =>
  ctx.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...(who?.headers ?? {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
const json = async (response: Response) => (await response.json()) as any
const setLabels = (id: string, labelIds: string[], who: Who = member) => call("PUT", `/api/reports/${id}/labels`, who, { labelIds })
const list = async (query = "") => json(await call("GET", `/api/reports?${query}`, member))
const activity = async (id: string) => (await json(await call("GET", `/api/reports/${id}/activity`, member))) as Array<{ kind: string; detail: unknown }>
const names = (labels: Array<{ name: string }>) => labels.map((label) => label.name)

beforeEach(async () => {
  ctx = await setupTestApp()
  member = await createUserWithToken(ctx.db)
  const other = await createWorkspaceRow(ctx.db, "Elsewhere")
  outsider = await createUserWithToken(ctx.db, { workspaceId: other.id, role: "admin" })
  reportId = (await createReadyReport(ctx.db, { reporterId: member.user.id })).id
  bug = await json(await call("POST", "/api/labels", member, { name: "Bug" }))
  checkout = await json(await call("POST", "/api/labels", member, { name: "Checkout" }))
  foreign = await json(await call("POST", "/api/labels", outsider, { workspaceId: other.id, name: "Theirs" }))
})

describe("a report's labels", () => {
  test("setting labels shows them on the report, in the list and in its activity", async () => {
    expect((await setLabels(reportId, [checkout.id, bug.id])).status).toBe(200)
    expect(names((await json(await call("GET", `/api/reports/${reportId}`, member))).labels)).toEqual(["Bug", "Checkout"])
    expect(names((await list()).items[0].labels)).toEqual(["Bug", "Checkout"])
    expect(await activity(reportId)).toContainEqual(expect.objectContaining({ kind: "labels", detail: { added: ["Bug", "Checkout"], removed: [] } }))
  })

  test("a report without labels lists an empty array", async () => {
    expect((await list()).items[0].labels).toEqual([])
  })

  test("the set replaces what was there and records both sides", async () => {
    await setLabels(reportId, [bug.id])
    const answer = await json(await setLabels(reportId, [checkout.id]))
    expect(names(answer.labels)).toEqual(["Checkout"])
    expect(await activity(reportId)).toContainEqual(expect.objectContaining({ kind: "labels", detail: { added: ["Checkout"], removed: ["Bug"] } }))
  })

  test("the same set again records nothing", async () => {
    await setLabels(reportId, [bug.id])
    const before = (await activity(reportId)).length
    expect((await setLabels(reportId, [bug.id])).status).toBe(200)
    expect(await activity(reportId)).toHaveLength(before)
  })

  test("a label of another workspace is refused and nothing changes", async () => {
    await setLabels(reportId, [bug.id])
    const answer = await setLabels(reportId, [checkout.id, foreign.id])
    expect(answer.status).toBe(422)
    expect((await json(answer)).code).toBe("label_not_found")
    expect(names((await json(await call("GET", `/api/reports/${reportId}`, member))).labels)).toEqual(["Bug"])
  })

  test("more than 10 labels is refused", async () => {
    expect((await setLabels(reportId, Array.from({ length: 11 }, (_, i) => `id-${i}`))).status).toBe(422)
  })

  test("two sets at once never leave more than 10 labels", async () => {
    const ids: string[] = []
    for (let i = 0; i < 12; i++) ids.push((await json(await call("POST", "/api/labels", member, { name: `L${i}` }))).id)
    await Promise.all([setLabels(reportId, ids.slice(0, 6)), setLabels(reportId, ids.slice(6, 12))])
    const labels = (await json(await call("GET", `/api/reports/${reportId}`, member))).labels as unknown[]
    expect(labels).toHaveLength(6)
  })

  test("an outsider can't set labels", async () => {
    const answer = await setLabels(reportId, [], outsider)
    expect(answer.status).toBe(404)
    expect((await json(answer)).code).toBe("report_not_found")
  })
})

describe("the list's label filter", () => {
  test("filtering by labels finds reports carrying any of them", async () => {
    const r1 = reportId
    const r2 = (await createReadyReport(ctx.db, { reporterId: member.user.id })).id
    await createReadyReport(ctx.db, { reporterId: member.user.id })
    await setLabels(r1, [bug.id])
    await setLabels(r2, [checkout.id])
    const found = await list(`labelId=${bug.id}&labelId=${checkout.id}`)
    expect(found.items.map((item: { id: string }) => item.id)).toEqual([r2, r1])
    expect((await json(await call("GET", `/api/reports/counts?labelId=${bug.id}`, member))).total).toBe(1)
  })

  test("an unknown label id finds nothing", async () => {
    await setLabels(reportId, [bug.id])
    const answer = await call("GET", "/api/reports?labelId=gone", member)
    expect(answer.status).toBe(200)
    expect((await json(answer)).items).toEqual([])
  })
})

test("a share viewer gets no labels", async () => {
  const shared = await createReadyReport(ctx.db, { reporterId: member.user.id, visibility: "public" })
  await setLabels(shared.id, [bug.id])
  const answer = await json(await call("GET", `/api/share/${shared.shareSlug}`, null))
  expect(answer.id).toBe(shared.id)
  expect(answer.labels).toBeUndefined()
})
