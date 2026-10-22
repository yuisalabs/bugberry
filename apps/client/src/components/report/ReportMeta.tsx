import { issueReference, PROVIDER_LABELS } from "@bugberry/shared"
import { RiComputerLine, RiGlobalLine, RiMacbookLine } from "@remixicon/react"
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

const chip = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground"

/** Who reported it and when; then the browser, system and screen it came from, and the issues it already has, as chips. */
export function ReportMeta({
  report,
  issues,
  part = "both",
}: {
  report: ReportDetail
  issues: SentIssue[]
  /** The report page shows the chips above the title and the byline under it. */
  part?: "both" | "chips" | "byline"
}) {
  const now = useNow()
  const { browser, os, viewport } = report.device
  return (
    <div className="flex flex-col gap-3">
      {part !== "chips" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Avatar
            src={report.reporter.image}
            initials={initialsOf(report.reporter.name)}
            size="xs"
            className="shrink-0 bg-primary-subtle text-primary-subtle-foreground"
          />
          <span>
            {report.reporter.name} via {reportedVia(browser)} · {formatRelative(report.createdAt, now)}
          </span>
        </p>
      )}
      {part !== "byline" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={chip}>
            <RiGlobalLine aria-hidden className="size-3.5 text-muted-foreground" />
            {browser}
          </span>
          <span className={chip}>
            <RiMacbookLine aria-hidden className="size-3.5 text-muted-foreground" />
            {os}
          </span>
          {viewport && (
            <span className={chip}>
              <RiComputerLine aria-hidden className="size-3.5 text-muted-foreground" />
              {viewport.replace(/\s*x\s*/i, " × ")}
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
                className={`${chip} hover:bg-muted`}
              >
                {issue.provider ? PROVIDER_LABELS[issue.provider] : "Issue"} {issueReference(issue.provider, issue.externalId)}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
