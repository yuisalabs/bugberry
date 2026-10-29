import { and, eq, or } from "drizzle-orm"
import { report, workspace } from "../db/schema"
import { notFound } from "../lib/errors"
import { memberRole, requireMember, resolveWorkspace } from "../modules/workspaces/access"
import { reportAccess } from "../modules/reports/access"
import { type McpContext, McpToolError } from "./context"

export type ParsedRef = { kind: "id"; id: string } | { kind: "slug"; slug: string } | { kind: "number"; number: number }

export interface ResolvedReport {
  id: string
  workspaceId: string
  /** "member" works on the report; "viewer" reads it through its share link, like the share page. */
  access: "member" | "viewer"
  row: typeof report.$inferSelect
}

const ID = /^[A-Za-z0-9_-]{8,64}$/
const NUMBER = /^(?:bb-|#)?(\d{1,9})$/i

export const REPORT_NOT_FOUND = "Report not found"
export const MEMBER_ONLY = "Only members of this report's workspace can do this"

const reportNotFound = () => new McpToolError("report_not_found", REPORT_NOT_FOUND)

/**
 * What an agent pasted: a dashboard link, a share link, BB-123 / #123 / 123, or a raw id. Links are
 * only read on this install's own origin, so a link to another BugBerry never matches a report here.
 */
export function parseReportRef(ref: string, appUrl: string): ParsedRef | null {
  const value = ref.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return null
    }
    if (url.origin !== new URL(appUrl).origin) return null
    const report = url.pathname.match(/^\/app\/r\/([A-Za-z0-9_-]{8,64})\/?$/)
    if (report?.[1]) return { kind: "id", id: report[1] }
    const share = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{4,64})\/?$/)
    if (share?.[1]) return { kind: "slug", slug: share[1] }
    return null
  }
  const number = value.match(NUMBER)
  if (number?.[1]) return { kind: "number", number: Number(number[1]) }
  if (ID.test(value)) return { kind: "id", id: value }
  return null
}

/** The workspace an agent named (id or slug), after checking the caller belongs to it. */
export async function workspaceFor(ctx: McpContext, requested?: string): Promise<string> {
  const { db } = ctx.deps
  const user = ctx.caller.user
  if (!requested) return resolveWorkspace(db, user)
  const [row] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(or(eq(workspace.id, requested), eq(workspace.slug, requested.toLowerCase())))
    .limit(1)
  if (!row) throw notFound("workspace_not_found", "Workspace not found")
  await requireMember(db, user.id, row.id)
  return row.id
}

/** A finished report the caller may at least read, found from any form of reference. */
export async function resolveReportRef(ctx: McpContext, ref: string, workspaceRef?: string): Promise<ResolvedReport> {
  const { db, config } = ctx.deps
  const parsed = parseReportRef(ref, config.appUrl)
  if (!parsed) throw reportNotFound()

  const ready = eq(report.uploadStatus, "ready")
  const where =
    parsed.kind === "id"
      ? and(eq(report.id, parsed.id), ready)
      : parsed.kind === "slug"
        ? and(eq(report.shareSlug, parsed.slug), ready)
        : and(eq(report.workspaceId, await workspaceFor(ctx, workspaceRef)), eq(report.number, parsed.number), ready)
  const [row] = await db.select().from(report).where(where).limit(1)
  if (!row) throw reportNotFound()

  const user = ctx.caller.user
  if (await memberRole(db, user.id, row.workspaceId)) {
    return { id: row.id, workspaceId: row.workspaceId, access: "member", row }
  }
  if (reportAccess(row, { email: user.email, isMember: false })) {
    return { id: row.id, workspaceId: row.workspaceId, access: "viewer", row }
  }
  throw reportNotFound()
}

export function requireMemberAccess(resolved: ResolvedReport): void {
  if (resolved.access !== "member") throw new McpToolError("member_only", MEMBER_ONLY)
}
