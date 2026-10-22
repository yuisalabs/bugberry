import { matchProject, type ProjectWithPatterns } from "@bugberry/shared"

/** Reports of one page address in one project: what the overview query hands over. */
export interface PageRow {
  pageUrl: string
  projectId: string | null
  reports: number
  lastReportAt: Date
}

/** A page no project's URL pattern catches, with the project its reports were filed in most. */
export interface UnmatchedPage {
  /** Host and path, without scheme, query or a trailing slash: `staging.quinella.ai/checkout`. */
  page: string
  reports: number
  lastReportAt: Date
  suggestedProjectId: string | null
}

/** `staging.quinella.ai/checkout` for `https://staging.quinella.ai/checkout/?step=pay`; null for an address that isn't one. */
export function pageOf(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return `${url.host}${url.pathname.replace(/\/+$/, "")}`
  } catch {
    return null
  }
}

/**
 * The pages whose reports no URL pattern files: grouped by host and path, most reports first. The extension
 * sent those reports to the project picked last, so the one most of them landed in is the suggestion.
 */
export function unmatchedPages(rows: readonly PageRow[], projects: readonly ProjectWithPatterns[], limit = 20): UnmatchedPage[] {
  const pages = new Map<string, { reports: number; lastReportAt: Date; byProject: Map<string, number> }>()
  for (const row of rows) {
    const page = pageOf(row.pageUrl)
    if (!page || matchProject(projects, row.pageUrl)) continue
    const entry = pages.get(page) ?? { reports: 0, lastReportAt: row.lastReportAt, byProject: new Map<string, number>() }
    entry.reports += row.reports
    if (row.lastReportAt > entry.lastReportAt) entry.lastReportAt = row.lastReportAt
    if (row.projectId) entry.byProject.set(row.projectId, (entry.byProject.get(row.projectId) ?? 0) + row.reports)
    pages.set(page, entry)
  }
  return [...pages.entries()]
    .map(([page, entry]) => ({
      page,
      reports: entry.reports,
      lastReportAt: entry.lastReportAt,
      suggestedProjectId: [...entry.byProject.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.reports - a.reports || b.lastReportAt.getTime() - a.lastReportAt.getTime())
    .slice(0, limit)
}
