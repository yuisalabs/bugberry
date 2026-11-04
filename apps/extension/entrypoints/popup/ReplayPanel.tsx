import { REPLAY_WINDOWS_MS, type ReplayWindowMs } from "@bugberry/shared"
import { Button } from "@bugberry/ui/button"
import { RiHistoryLine } from "@remixicon/react"
import { Button as AriaButton, ToggleButton } from "react-aria-components"
import type { ReplayStatus } from "../../lib/shared/messages"
import { chip } from "./CapturePanel"
import { InfoBox, SectionLabel } from "./parts"

/**
 * Under the capture controls: arm the tab for replay, or capture what it has kept. `compact` is one row (Record mode,
 * whose controls already fill Chrome's 600 px popup); the window and the shortcut hint are in Screenshot mode.
 */
export function ReplayPanel(props: {
  status: ReplayStatus | null
  windowMs: ReplayWindowMs
  /** chrome://extensions/shortcuts, or Opera's or Edge's own. */
  shortcutsPage: string
  onWindow(ms: ReplayWindowMs): void
  onArm(): void
  onDisarm(): void
  onCapture(): void
  busy: boolean
  compact?: boolean
}) {
  const { status } = props
  if (!status) return null
  if (props.compact) return <ReplayRow {...props} status={status} />
  return (
    <section className="flex flex-col gap-2.5 border-t border-border px-3.5 py-3">
      <SectionLabel>Replay</SectionLabel>
      {status.armed ? (
        <>
          <div className="flex items-center gap-3">
            <Button size="sm" isDisabled={props.busy || status.suspended} onPress={props.onCapture}>
              <RiHistoryLine size={16} aria-hidden />
              {status.suspended ? "Paused while recording" : `Capture last ~${status.windowMs / 1000}s`}
            </Button>
            <AriaButton
              onPress={props.onDisarm}
              className="cursor-pointer rounded-sm text-sm font-semibold text-muted-foreground underline outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Disarm
            </AriaButton>
          </div>
          {status.degraded && <InfoBox>{`Buffer is full; the capture will be shorter than ${status.windowMs / 1000}s.`}</InfoBox>}
          <p className="text-xs text-muted-foreground">{`Add a shortcut at ${props.shortcutsPage}`}</p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {REPLAY_WINDOWS_MS.map((ms) => (
            <ToggleButton key={ms} isSelected={props.windowMs === ms} onChange={() => props.onWindow(ms)} className={chip(props.windowMs === ms)}>
              {`${ms / 1000}s`}
            </ToggleButton>
          ))}
          <Button size="sm" className="ml-auto" isDisabled={props.busy} onPress={props.onArm}>
            Arm replay
          </Button>
        </div>
      )}
    </section>
  )
}

function ReplayRow(props: Parameters<typeof ReplayPanel>[0] & { status: ReplayStatus }) {
  const { status } = props
  const seconds = status.armed ? status.windowMs / 1000 : props.windowMs / 1000
  const state = !status.armed ? "Off" : status.suspended ? "Paused while recording" : `${seconds}s${status.degraded ? " · buffer full" : ""}`
  return (
    <section aria-label="Replay" className="flex items-center gap-2 border-t border-border px-3.5 py-2.5">
      <RiHistoryLine size={16} aria-hidden className="shrink-0 text-muted-foreground" />
      <span className="text-sm font-semibold">Replay</span>
      <span className="min-w-0 truncate text-sm text-muted-foreground">{state}</span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        {status.armed ? (
          <>
            <AriaButton
              onPress={props.onDisarm}
              className="cursor-pointer rounded-sm text-sm font-semibold text-muted-foreground underline outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Disarm
            </AriaButton>
            <Button size="sm" aria-label={`Capture last ~${seconds}s`} isDisabled={props.busy || status.suspended} onPress={props.onCapture}>
              Capture
            </Button>
          </>
        ) : (
          <Button size="sm" isDisabled={props.busy} onPress={props.onArm}>
            {`Arm ${seconds}s`}
          </Button>
        )}
      </span>
    </section>
  )
}
