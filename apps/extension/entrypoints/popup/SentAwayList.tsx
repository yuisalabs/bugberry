import { Button } from "@bugberry/ui/button"
import type { SentAway } from "../../lib/drafts/sent-away"

/** Reports the background sent from the queue while no editor was open; each stays until opened or dismissed. */
export function SentAwayList(props: { sent: SentAway[]; onOpen(sent: SentAway): void; onDismiss(draftId: string): void }) {
  if (props.sent.length === 0) return null
  return (
    <ul className="mx-3.5 mb-3 flex flex-col gap-1.5" aria-label="Sent while you were away">
      {props.sent.map((sent) => (
        <li key={sent.draftId} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{`Sent: ${sent.title}`}</span>
          <span className="flex shrink-0 gap-1">
            <Button intent="plain" size="xs" className="text-primary" onPress={() => props.onOpen(sent)}>
              Open
            </Button>
            <Button intent="plain" size="xs" onPress={() => props.onDismiss(sent.draftId)}>
              Dismiss
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}
