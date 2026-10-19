import { emailDomain, FREE_EMAIL_DOMAINS, type Visibility } from "@bugberry/shared"

/**
 * Who may see a report:
 * - members of its workspace work on it ("member");
 * - anyone may read a public report, and anyone at the reporter's company domain an internal one
 *   ("viewer", read-only through the share link);
 * - nobody else. Free email domains are not companies, so "internal" never reaches anyone there.
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
