import type { Server } from "bun"
import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { createUserResolver } from "../../plugins/auth"
import { isEmailAllowed } from "../auth/policy"
import { notFound, tooManyRequests, unauthorized } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { loadReportDetail } from "../reports/detail"
import { memberRole } from "../workspaces/access"
import { reportAccess } from "../reports/access"
import { findReadyReportVisibility, findSharePreview } from "../reports/repository"
import { previewTags } from "./preview"

const SHARE_VIEWS_PER_MINUTE = 60
/** Chat apps fetch a link's tags and image once per paste; this limit is separate from the page's. */
export const SHARE_PREVIEWS_PER_MINUTE = 120
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
 * The address to rate-limit by. Each trusted proxy appends its sender, so the entry `proxyHops` from the right came
 * from the outermost one and everything left of it from the client; with fewer entries than hops, all are trusted.
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
  const previewLimiter = createRateLimiter({ limit: SHARE_PREVIEWS_PER_MINUTE, windowMs: 60_000 })
  const imageNotFound = () =>
    Response.json({ error: { code: "report_not_found", message: "Report not found" } }, { status: 404, headers: { "cache-control": "no-store" } })

  return new Elysia()
    // Pasted by nginx into the share page's head, so it always answers 200: the generic card stands in for
    // anything that isn't a public report, and for a caller over the limit. Never depends on who asks.
    .get("/share/:slug/meta", async ({ params, request, server }) => {
      const allowed = previewLimiter.consume(clientIp(request, server, deps.config.proxyHops))
      const row = allowed ? await findSharePreview(deps.db, params.slug) : null
      const preview = row && {
        number: row.number,
        title: row.title,
        captureType: row.captureType,
        pageUrl: row.pageUrl,
        errors: row.debuggerSummary.errors,
        failedRequests: row.debuggerSummary.failedRequests,
        hasThumbnail: row.thumbnailKey !== null,
      }
      return new Response(previewTags(deps.config.appUrl, params.slug, preview), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      })
    })
    // A stable address for the card's image: signed storage links expire before chat apps fetch it.
    .get("/share/:slug/preview.jpg", async ({ params, request, server }) => {
      if (!previewLimiter.consume(clientIp(request, server, deps.config.proxyHops))) throw tooManyRequests()
      const row = await findSharePreview(deps.db, params.slug)
      const image = row?.thumbnailKey ? await deps.storage.read(row.thumbnailKey) : null
      if (!image) return imageNotFound()
      // Private: a CDN copy would outlive the report leaving public; chat apps keep their own anyway.
      return new Response(image, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } })
    })
    .get("/share/:slug", async ({ params, request, server }) => {
    if (!limiter.consume(clientIp(request, server, deps.config.proxyHops))) throw tooManyRequests()

    const target = await findReadyReportVisibility(deps.db, { shareSlug: params.slug })
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
    const detail = await loadReportDetail(deps, { shareSlug: params.slug }, isMember ? {} : { readTtlSeconds: ANONYMOUS_READ_TTL_SECONDS })
    if (!detail) throw notFound("report_not_found", "Report not found")
    // A member who followed a share link is sent on to the full report page.
    return { ...detail, viewerIsMember: isMember }
  })
}
