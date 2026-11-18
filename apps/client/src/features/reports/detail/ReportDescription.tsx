import { memo } from "react"
import { Markdown } from "@bugberry/ui/markdown"

/** A report's description on the report page and the share page. Memoised: the report page re-renders on every player tick. */
export const ReportDescription = memo(function ReportDescription({ description }: { description: string }) {
  return (
    <Markdown look="description" className="text-sm text-muted-foreground">
      {description}
    </Markdown>
  )
})
