import { Link } from "@bugberry/ui/link"
import { CopyButton } from "../ui"

/** What a person pastes into their AI agent to have it debug this report through the MCP server. */
export function copyForAiText(origin: string, reportId: string): string {
  return `Use the BugBerry MCP server to debug this report: ${origin}/app/r/${reportId}`
}

export function CopyForAiButton({ reportId, origin = window.location.origin }: { reportId: string; origin?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CopyButton text={copyForAiText(origin, reportId)} label="Copy for AI" />
      <Link href="/app/settings/ai" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
        Set up
      </Link>
    </span>
  )
}
