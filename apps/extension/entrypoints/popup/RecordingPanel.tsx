import { RiDeleteBinLine, RiPauseLargeLine, RiPlayLargeLine, RiRestartLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { Button as AriaButton } from "react-aria-components"
import { countText, recordingLabel } from "../../lib/drafts/popup"
import type { PopupRecordingStatus } from "../../lib/recording/recording-state"
import { Dial, InfoBox } from "./parts"

/** "00:12", "12:05". */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

/** The lower panel while a recording runs: the same controls as the bar on the page. */
export function RecordingPanel(props: {
  live: Extract<PopupRecordingStatus, { recording: true }>
  activeTabId: number | null
  onPause(): void
  onResume(): void
  onRestart(): void
  onDiscard(): void
  onStop(): void
}) {
  const { live } = props
  const { errors, failedRequests, actions } = live.counts
  return (
    <div className="flex flex-col items-center px-4 pt-4 pb-4">
      <p className="flex items-center gap-2 text-sm">
        <span aria-hidden className={`size-2.5 rounded-full bg-danger ${live.paused ? "" : "animate-pulse"}`} />
        <span className="font-mono font-bold tracking-wider text-danger">REC</span>
        <span className="text-muted-foreground">{recordingLabel(live.source, live.tabId === props.activeTabId)}</span>
      </p>
      <p className="mt-1 font-mono text-[32px] leading-tight font-bold text-foreground tabular-nums">{clock(live.elapsedMs)}</p>
      <div className="mt-2">
        <Dial label="Stop and review" tone="danger" onPress={props.onStop}>
          <span aria-hidden className="size-[22px] rounded-[5px] bg-danger-foreground" />
        </Dial>
      </div>
      <p aria-hidden className="mt-2 font-heading text-base font-bold text-foreground">
        Stop and review
      </p>
      <div className="mt-3 flex gap-2">
        {live.paused ? (
          <Control icon={<RiPlayLargeLine size={16} aria-hidden />} onPress={props.onResume}>
            Resume
          </Control>
        ) : (
          <Control icon={<RiPauseLargeLine size={16} aria-hidden />} onPress={props.onPause}>
            Pause
          </Control>
        )}
        <Control icon={<RiRestartLine size={16} aria-hidden />} onPress={props.onRestart}>
          Restart
        </Control>
        <Control icon={<RiDeleteBinLine size={16} aria-hidden />} danger onPress={props.onDiscard}>
          Discard
        </Control>
      </div>
      <div className="mt-4 grid w-full grid-cols-3 gap-2">
        <Count alarm={errors > 0} n={errors} text={countText(errors, "error", "errors")} />
        <Count n={failedRequests} text={`${failedRequests} failed req.`} />
        <Count n={actions} text={countText(actions, "action", "actions")} />
      </div>
      <div className="mt-3 w-full">
        <InfoBox>Closing this popup keeps recording. The bar on the page has the same controls.</InfoBox>
      </div>
    </div>
  )
}

function Control(props: { icon: ReactNode; danger?: boolean; onPress(): void; children: string }) {
  return (
    <AriaButton
      onPress={props.onPress}
      className={`flex h-[34px] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-background px-3.5 text-sm font-semibold outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 ${
        props.danger ? "text-danger" : "text-foreground"
      }`}
    >
      {props.icon}
      {props.children}
    </AriaButton>
  )
}

/** One live count: the number in bold, then what it counts. Errors turn red once there is one. */
function Count({ n, text, alarm = false }: { n: number; text: string; alarm?: boolean }) {
  const words = text.slice(String(n).length + 1)
  return (
    <span
      className={`flex h-[30px] items-center justify-center gap-1 rounded-lg text-[13px] ${alarm ? "bg-danger-subtle text-danger" : "bg-background text-muted-foreground"}`}
    >
      <span aria-hidden className={`font-mono font-bold ${alarm ? "" : "text-foreground"}`}>
        {n}
      </span>
      <span aria-hidden>{words}</span>
      <span className="sr-only">{text}</span>
    </span>
  )
}
