import { beforeEach, describe, expect, test } from "bun:test"
import type { McpContext } from "../src/mcp/context"
import { parseReportRef, resolveReportRef } from "../src/mcp/refs"
import { addMember, createReadyReport, createUser, createWorkspaceRow, setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>

beforeEach(async () => {
  ctx = await setupTestApp()
})

const APP = "http://localhost:3000"
const mcpCtx = (user: Awaited<ReturnType<typeof createUser>>): McpContext => ({
  deps: ctx,
  caller: { user, scopes: new Set(["bugberry:read", "bugberry:write"]), via: { kind: "token" } },
})

describe("parseReportRef", () => {
  test.each([
    [`${APP}/app/r/01a15593-0b10-7357-a413-c2d8e2c829ed`, { kind: "id", id: "01a15593-0b10-7357-a413-c2d8e2c829ed" }],
    [`${APP}/app/r/01a15593-0b10-7357-a413-c2d8e2c829ed#comment-1`, { kind: "id", id: "01a15593-0b10-7357-a413-c2d8e2c829ed" }],
    [`${APP}/s/AbCdEf123`, { kind: "slug", slug: "AbCdEf123" }],
    ["https://other.host/app/r/01a15593-0b10-7357-a413-c2d8e2c829ed", null],
    ["BB-7", { kind: "number", number: 7 }],
    ["bb-7", { kind: "number", number: 7 }],
    ["#7", { kind: "number", number: 7 }],
    ["7", { kind: "number", number: 7 }],
    ["01a15593-0b10-7357-a413-c2d8e2c829ed", { kind: "id", id: "01a15593-0b10-7357-a413-c2d8e2c829ed" }],
    ["drop table; --", null],
    ["", null],
  ])("%s", (ref, expected) => {
    expect(parseReportRef(ref, APP)).toEqual(expected as never)
  })
})

describe("resolveReportRef", () => {
  test("members resolve by id, share slug and number", async () => {
    const ana = await createUser(ctx.db)
    const report = await createReadyReport(ctx.db, { reporterId: ana.id })
    for (const ref of [report.id, `${APP}/app/r/${report.id}`, `${APP}/s/${report.shareSlug}`, `BB-${report.number}`]) {
      const resolved = await resolveReportRef(mcpCtx(ana), ref)
      expect(resolved).toMatchObject({ id: report.id, workspaceId: ctx.workspace.id, access: "member" })
    }
  })

  test("BB-n resolves in the given workspace, not another one with the same number", async () => {
    const ana = await createUser(ctx.db)
    const second = await createWorkspaceRow(ctx.db, "Second")
    await addMember(ctx.db, second.id, ana.id)
    const here = await createReadyReport(ctx.db, { reporterId: ana.id, number: 12 })
    const there = await createReadyReport(ctx.db, { reporterId: ana.id, number: 12, workspaceId: second.id })
    expect((await resolveReportRef(mcpCtx(ana), "BB-12")).id).toBe(here.id)
    expect((await resolveReportRef(mcpCtx(ana), "BB-12", second.id)).id).toBe(there.id)
    expect((await resolveReportRef(mcpCtx(ana), "BB-12", second.slug ?? "")).id).toBe(there.id)
  })

  test("a workspace the caller is not in is refused", async () => {
    const ana = await createUser(ctx.db)
    const other = await createWorkspaceRow(ctx.db, "Other")
    await expect(resolveReportRef(mcpCtx(ana), "BB-1", other.id)).rejects.toThrow("Workspace not found")
  })

  test("outsiders get Report not found for workspace reports, viewer for public ones", async () => {
    const ana = await createUser(ctx.db)
    const outsider = await createUser(ctx.db, { workspaceId: null, email: "eve@kantor.test" })
    const closed = await createReadyReport(ctx.db, { reporterId: ana.id, visibility: "workspace" })
    const open = await createReadyReport(ctx.db, { reporterId: ana.id, visibility: "public" })
    const internal = await createReadyReport(ctx.db, { reporterId: ana.id, visibility: "internal" })
    await expect(resolveReportRef(mcpCtx(outsider), closed.id)).rejects.toThrow("Report not found")
    expect((await resolveReportRef(mcpCtx(outsider), open.id)).access).toBe("viewer")
    expect((await resolveReportRef(mcpCtx(outsider), `${APP}/s/${internal.shareSlug}`)).access).toBe("viewer")
  })

  test("uploading reports do not resolve", async () => {
    const ana = await createUser(ctx.db)
    const uploading = await createReadyReport(ctx.db, { reporterId: ana.id, uploadStatus: "uploading" })
    await expect(resolveReportRef(mcpCtx(ana), uploading.id)).rejects.toThrow("Report not found")
  })

  test("garbage refs answer Report not found", async () => {
    const ana = await createUser(ctx.db)
    await expect(resolveReportRef(mcpCtx(ana), "nope!")).rejects.toThrow("Report not found")
  })
})
