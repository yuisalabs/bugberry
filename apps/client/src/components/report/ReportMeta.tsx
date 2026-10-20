import { PROVIDER_LABELS } from "@bugberry/shared"
import { RiAspectRatioLine, RiComputerLine } from "@remixicon/react"
import { Avatar } from "@bugberry/ui/avatar"
import { Link } from "@bugberry/ui/link"
import { useNow } from "../../hooks/useNow"
import type { ReportDetail } from "../../lib/api"
import { formatRelative } from "../../lib/format"
import { initialsOf } from "../../lib/people"
import type { SentIssue } from "../../lib/report-page"
import { safeHttpUrl } from "../../lib/urls"

/** "Firefox extension" from the report's "Firefox 131"; a browser the extension couldn't name stays generic. */
export function reportedVia(browser: string): string {
  const name = browser.replace(/\s+\d[\d.]*$/, "").trim()
  return !name || name === "Unknown browser" ? "the BugBerry extension" : `${name} extension`
}

/** Who reported it and when, the browser it came from, and the issues it already has. */
export function ReportMeta({ report, issues }: { report: ReportDetail; issues: SentIssue[] }) {
  const now = useNow()
  const { browser, os, viewport } = report.device
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Avatar
          src={report.reporter.image}
          initials={initialsOf(report.reporter.name)}
          size="xs"
          className="bg-secondary text-secondary-foreground"
        />
        <span>
          {report.reporter.name} reported via {reportedVia(browser)}, {formatRelative(report.createdAt, now)}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <RiComputerLine aria-hidden className="size-3.5" />
        <span>
          {browser}, {os}
        </span>
      </span>
      {viewport && (
        <span className="flex items-center gap-1.5">
          <RiAspectRatioLine aria-hidden className="size-3.5" />
          <span>{viewport.replace(/\s*x\s*/i, " × ")}</span>
        </span>
      )}
      {issues.map((issue) => {
        const href = issue.externalUrl ? safeHttpUrl(issue.externalUrl) : null
        if (!href) return null
        return (
          <Link
            key={`${issue.provider}-${issue.externalId}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-2 py-0.5 font-medium text-foreground hover:bg-muted"
          >
            {issue.provider ? PROVIDER_LABELS[issue.provider] : "Issue"} #{issue.externalId}
          </Link>
        )
      })}
    </div>
  )
}
