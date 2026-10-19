import { RiPlayFill } from "@remixicon/react"
import { useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import type { FlaggedIssue, IssueLevel, IssueTarget } from "../../lib/flagged-issues"
import { formatOffset } from "../../lib/format"

const SHOWN = 3

const DOT: Record<IssueLevel, string> = {
  1: "bg-danger",
  2: "bg-danger",
  3: "bg-warning",
  4: "bg-muted-foreground/60",
}

/**
 * "BugBerry flagged": every problem in the recording, most important first. Three rows show; the rest
 * open with "Show N more". Jump moves the video; the sentence opens the matching DevTools tab.
 */
export function FlaggedIssues({
  issues,
  onJump,
  onOpen,
}: {
  issues: FlaggedIssue[]
  onJump(offsetMs: number): void
  onOpen(target: IssueTarget): void
}) {
  const [expanded, setExpanded] = useState(false)
  if (issues.length === 0) return null
  const shown = expanded ? issues : issues.slice(0, SHOWN)
  const hidden = issues.length - SHOWN

  return (
    <section aria-label="BugBerry flagged" className="rounded-xl border border-primary/20 bg-primary-subtle/60 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {/* The mark as a background image: page text below is never turned into elements. */}
        <span aria-hidden className="size-5 shrink-0 bg-[url(/assets/bugberry_icon_small.webp)] bg-contain bg-center bg-no-repeat" />
        BugBerry flagged {issues.length} {issues.length === 1 ? "issue" : "issues"}
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-primary/10">
        {shown.map((issue) => (
          <li key={issue.key} className="flex items-center gap-3 py-1.5 text-sm">
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[issue.level]}`} />
            <AriaButton
              onPress={() => onOpen(issue.target)}
              className="flex min-w-0 flex-1 items-baseline gap-2 text-left hover:underline"
            >
              <span title={issue.source ? `${issue.text} (${issue.source})` : issue.text} className="truncate font-mono text-xs text-foreground">
                {issue.text}
              </span>
              {issue.source && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{issue.source}</span>}
            </AriaButton>
            {issue.time.kind === "video" ? (
              <Button
                intent="outline"
                size="xs"
                onPress={() => onJump(issue.time.kind === "video" ? issue.time.offsetMs : 0)}
                className="shrink-0 bg-background text-primary"
              >
                <RiPlayFill aria-hidden />
                Jump to {formatOffset(issue.time.offsetMs)}
              </Button>
            ) : issue.time.kind === "before" || issue.time.kind === "after" ? (
              <span className="shrink-0 text-xs text-muted-foreground">{issue.time.kind} recording</span>
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <AriaButton
          onPress={() => setExpanded((value) => !value)}
          className="mt-1 text-xs font-semibold text-primary hover:underline"
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
        </AriaButton>
      )}
    </section>
  )
}
