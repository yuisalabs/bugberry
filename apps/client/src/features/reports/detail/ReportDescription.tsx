import { Markdown } from "@bugberry/ui/markdown"

/** A report's description on the report page and the share page. */
export function ReportDescription({ description }: { description: string }) {
  return (
    <Markdown look="description" className="text-sm text-muted-foreground">
      {description}
    </Markdown>
  )
}
