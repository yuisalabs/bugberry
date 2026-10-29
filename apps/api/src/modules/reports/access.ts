import { emailDomain, FREE_EMAIL_DOMAINS, type Visibility } from "@bugberry/shared"

/**
 * Members of the workspace work on a report; anyone reads a public one and the reporter's company domain an
 * internal one, read-only through the share link ("viewer"). Free email domains are not companies.
 */
export function reportAccess(
  report: { workspaceId: string; visibility: Visibility; reporterDomain: string | null },
  viewer: { email: string; isMember: boolean } | null,
): "member" | "viewer" | null {
  if (viewer?.isMember) return "member"
  if (report.visibility === "public") return "viewer"
  if (report.visibility !== "internal" || !viewer) return null
  const domain = report.reporterDomain?.toLowerCase()
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null
  return emailDomain(viewer.email) === domain ? "viewer" : null
}
