import { Button } from "@bugberry/ui/button"
import { RiArrowLeftSLine } from "@remixicon/react"
import { canDelete, draftNote } from "../../lib/drafts/popup"
import type { RecordingStatus } from "../../lib/recording/recording-flow"
import type { ReportDraft } from "../../lib/shared/types"

/** Drafts that were never sent: open one in the review, or delete it. */
export function DraftList(props: {
  drafts: ReportDraft[]
  recording: RecordingStatus | undefined
  onOpenDraft(id: string): void
  onDeleteDraft(id: string): void
  onBack(): void
}) {
  return (
    <main className="flex flex-col gap-3 bg-background p-3.5 text-foreground">
      <header className="flex items-center gap-2">
        <Button intent="plain" size="sq-sm" aria-label="Back" onPress={props.onBack}>
          <RiArrowLeftSLine size={16} aria-hidden />
        </Button>
        <h1 className="font-heading text-lg font-bold">Unsent drafts</h1>
      </header>
      <ul className="flex flex-col gap-2">
        {props.drafts.map((draft) => {
          const note = draftNote(draft, props.recording)
          return (
            <li key={draft.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
              <span className="min-w-0 truncate" title={draft.error ?? undefined}>
                {draft.page.title || draft.page.url}
                {note && <span className="ml-1 text-danger-subtle-foreground">{note}</span>}
              </span>
              <span className="flex shrink-0 gap-1">
                {draft.status !== "recording" && (
                  <Button intent="plain" size="xs" className="text-primary" onPress={() => props.onOpenDraft(draft.id)}>
                    Open
                  </Button>
                )}
                {canDelete(draft, props.recording) && (
                  <Button intent="plain" size="xs" className="text-danger-subtle-foreground" onPress={() => props.onDeleteDraft(draft.id)}>
                    Delete
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
