import { and, eq } from "drizzle-orm"
import type { Server } from "bun"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { createUserResolver } from "../../auth/plugin"
import { isEmailAllowed } from "../../auth/policy"
import { report } from "../../db/schema"
import { notFound, tooManyRequests, unauthorized } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { loadReportDetail } from "../reports/detail"
import { memberRole } from "../../workspaces/access"
import { reportAccess } from "../../workspaces/report-access"

const SHARE_VIEWS_PER_MINUTE = 60
/**
 * Presigned URLs cannot be revoked, so links handed to anonymous viewers stay short: once a report
 * is made internal again, they stop working within minutes. The viewer fetches fresh ones on expiry.
 */
const ANONYMOUS_READ_TTL_SECONDS = 5 * 60

/** Where rate limits read the client IP from, logged at startup so a missing TRUST_PROXY is visible. */
export function clientIpSource(proxyHops: number): string {
  if (proxyHops === 0) return "client IP from the direct connection; behind a reverse proxy set TRUST_PROXY=true"
  return `client IP from X-Forwarded-For, ${proxyHops} trusted proxy hop${proxyHops === 1 ? "" : "s"} from the right`
}

/**
 * The address to rate-limit by. Each trusted proxy appends the address it received the request from,
 * so the entry `proxyHops` from the right was written by the outermost trusted proxy; anything to its
 * left was written by the client. Fewer entries than hops means every entry came from a trusted proxy.
 */
export function clientIp(request: Request, server: Server<unknown> | null, proxyHops: number): string {
  if (proxyHops > 0) {
    const entries = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (entries.length > 0) return entries.at(-proxyHops) ?? entries[0] ?? "unknown"
  }
  return server?.requestIP(request)?.address ?? "unknown"
}

export function shareModule(deps: AppDeps) {
  const resolveUser = createUserResolver(deps)
  const limiter = createRateLimiter({ limit: SHARE_VIEWS_PER_MINUTE, windowMs: 60_000 })

  return new Elysia().get("/share/:slug", async ({ params, request, server }) => {
    if (!limiter.consume(clientIp(request, server, deps.config.proxyHops))) throw tooManyRequests()

    const where = and(eq(report.shareSlug, params.slug), eq(report.uploadStatus, "ready"))
    if (!where) throw notFound()
    const [target] = await deps.db
      .select({ workspaceId: report.workspaceId, visibility: report.visibility, reporterDomain: report.reporterDomain })
      .from(report)
      .where(where)
      .limit(1)
    if (!target) throw notFound("report_not_found", "Report not found")

    const resolved = await resolveUser(request.headers)
    // An MCP-only token reads reports through the MCP server, never here.
    const viewer = resolved?.tokenKind === "mcp" ? null : resolved
    const allowed = viewer && isEmailAllowed(viewer.email, deps.config.allowedEmailDomains) ? viewer : null
    const isMember = Boolean(allowed && (await memberRole(deps.db, allowed.id, target.workspaceId)))
    const access = reportAccess(target, allowed ? { email: allowed.email, isMember } : null)
    // Signed out: maybe signing in helps. Signed in without access: the report does not exist for them.
    if (!access && !allowed) throw unauthorized("Log in to view this report")
    if (!access) throw notFound("report_not_found", "Report not found")

    // Only members get the long-lived media links; viewers outside the workspace get short ones.
    const detail = await loadReportDetail(deps, where, isMember ? {} : { readTtlSeconds: ANONYMOUS_READ_TTL_SECONDS })
    if (!detail) throw notFound("report_not_found", "Report not found")
    // A member who followed a share link is sent on to the full report page.
    return { ...detail, viewerIsMember: isMember }
  })
}
