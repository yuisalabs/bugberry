import { RiPlayFill } from "@remixicon/react"
import { useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import type { FlaggedIssue, IssueLevel, IssueTarget } from "@bugberry/debugger-view"
import { formatOffset } from "../../../lib/format"

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
          // Phones: the whole message wraps beside its dot, and Jump goes to its own line under it.
          <li key={issue.key} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2 text-sm md:items-center md:py-1.5">
            <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full md:mt-0 ${DOT[issue.level]}`} />
            <AriaButton
              onPress={() => onOpen(issue.target)}
              className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left hover:underline max-md:basis-[calc(100%-1.25rem)] md:flex-nowrap"
            >
              <span
                title={issue.source ? `${issue.text} (${issue.source})` : issue.text}
                className="min-w-0 font-mono text-xs/5 break-all text-foreground md:truncate"
              >
                {issue.text}
              </span>
              {issue.source && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{issue.source}</span>}
            </AriaButton>
            {issue.time.kind === "video" ? (
              <Button
                intent="outline"
                size="xs"
                onPress={() => onJump(issue.time.kind === "video" ? issue.time.offsetMs : 0)}
                className="shrink-0 bg-background text-primary max-md:ml-5"
              >
                <RiPlayFill aria-hidden />
                Jump to {formatOffset(issue.time.offsetMs)}
              </Button>
            ) : issue.time.kind === "before" || issue.time.kind === "after" ? (
              <span className="shrink-0 text-xs text-muted-foreground max-md:ml-5">{issue.time.kind} recording</span>
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
