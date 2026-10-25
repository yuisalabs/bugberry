import { Button } from "@bugberry/ui/button"
import { Toggle } from "@bugberry/ui/toggle"
import {
  RiArrowRightUpFill,
  RiArrowRightUpLine,
  RiCheckboxBlankCircleFill,
  RiCheckboxBlankCircleLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiMapPinFill,
  RiMapPinLine,
  RiMicLine,
  RiMicOffLine,
  RiPauseFill,
  RiPencilFill,
  RiPencilLine,
  RiPlayFill,
  RiRestartLine,
} from "@remixicon/react"
import { type PointerEvent, type ReactNode, useEffect, useState } from "react"
import type { BarStatus } from "../../lib/recording-flow"

export type DrawTool = "pen" | "arrow" | "circle" | "note"

export interface BarViewProps {
  status: BarStatus
  drawing: boolean
  tool: DrawTool
  onPause(): void
  onResume(): void
  onMic(on: boolean): void
  onDraw(on: boolean): void
  onTool(tool: DrawTool): void
  onClear(): void
  onRestart(): void
  onDiscard(): void
  onStop(): void
  /** Esc with nothing of the bar's own to close: the page layer uses it to cancel a countdown. */
  onEscape(): void
  /** A press on the bar outside its buttons: the bar is dragged from there. */
  onDragStart?(event: PointerEvent<HTMLElement>): void
}

/** The bar's dark surfaces drag the bar; their buttons keep the usual pointer. */
const surface = "cursor-grab active:cursor-grabbing [&_button]:cursor-pointer"

/** Intent buttons in light ink on the dark bar; the hover tint follows the text. */
// Intent colours their icons through these variables (dark ink by default); here the icon follows the text.
const onDark =
  "[--btn-icon:currentColor] [--btn-icon-active:currentColor] [--toggle-icon:currentColor] [--toggle-icon-active:currentColor] text-background/80 hover:bg-current/10 hover:text-background pressed:bg-current/15"
/** A toggle that is on (a tool, the microphone, Draw) is drawn in the brand colour. */
const onDarkSelected = "selected:bg-primary selected:text-primary-foreground selected:hover:bg-primary/90 selected:hover:text-primary-foreground"

/** Each tool's icon: the line variant, or the fill variant for the chosen one. */
const TOOLS: Array<{ id: DrawTool; label: string; icon(chosen: boolean): ReactNode }> = [
  { id: "pen", label: "Pen", icon: (chosen) => <PenIcon on={chosen} /> },
  { id: "arrow", label: "Arrow", icon: (chosen) => (chosen ? <RiArrowRightUpFill {...iconProps} /> : <RiArrowRightUpLine {...iconProps} />) },
  {
    id: "circle",
    label: "Circle",
    icon: (chosen) => (chosen ? <RiCheckboxBlankCircleFill {...iconProps} /> : <RiCheckboxBlankCircleLine {...iconProps} />),
  },
  { id: "note", label: "Note", icon: (chosen) => (chosen ? <RiMapPinFill {...iconProps} /> : <RiMapPinLine {...iconProps} />) },
]

/** "00:42", "12:05". */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

/** Shown only once something went wrong; a quiet recording keeps the bar short. */
function errorsText(errors: number): string {
  return errors === 1 ? "1 error caught" : `${errors} errors caught`
}

const divider = <span aria-hidden className="mx-1 h-5 w-px bg-background/15" />

/**
 * A hover hint around an icon button: the frame is sized to the bar, so a tooltip popover would be cut off, and
 * React Aria's buttons don't take a title. Around the button (not inside), it also shows while the button is disabled.
 */
function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span title={text} className="inline-flex">
      {children}
    </span>
  )
}

/** The Recording Bar, as in recording-overlay.html: four groups on a dark bar, with the stop hint below. */
export function BarView(props: BarViewProps) {
  const { status } = props
  const [confirm, setConfirm] = useState<"restart" | "discard" | null>(null)
  // Esc closes what is open, nearest first: a confirmation, then Draw, then (for the page) a countdown.
  const { drawing, onDraw, onEscape } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (confirm) setConfirm(null)
      else if (drawing) onDraw(false)
      else onEscape()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [confirm, drawing, onDraw, onEscape])
  const micTitle = status.micAvailable ? (status.micOn ? "Turn the microphone off" : "Turn the microphone on") : "Allow the microphone in BugBerry first"

  return (
    <div className="flex flex-col items-center gap-2 p-1 font-sans text-background">
      {props.drawing && (
        <div onPointerDown={props.onDragStart} className={`flex items-center gap-1 rounded-xl bg-foreground p-1 shadow-lg ${surface}`}>
          {TOOLS.map((tool) => (
            <Hint key={tool.id} text={tool.label}>
              <Toggle
                size="sq-sm"
                aria-label={tool.label}
                isSelected={props.tool === tool.id}
                onChange={() => props.onTool(tool.id)}
                className={`${onDark} ${onDarkSelected}`}
              >
                {tool.icon(props.tool === tool.id)}
              </Toggle>
            </Hint>
          ))}
          {divider}
          <Button intent="plain" size="xs" onPress={props.onClear} className={onDark}>
            Clear
          </Button>
        </div>
      )}
      {confirm && (
        <div role="alertdialog" onPointerDown={props.onDragStart} className={`flex items-center gap-3 rounded-xl bg-foreground px-3 py-2 text-sm shadow-lg ${surface}`}>
          <span>{confirm === "restart" ? "Delete this recording and start over?" : "Delete this recording?"}</span>
          <Button intent="plain" size="xs" onPress={() => setConfirm(null)} className={onDark}>
            Cancel
          </Button>
          <Button
            intent="danger"
            size="xs"
            onPress={() => {
              setConfirm(null)
              if (confirm === "restart") props.onRestart()
              else props.onDiscard()
            }}
          >
            Delete
          </Button>
        </div>
      )}
      <div data-bar-pill onPointerDown={props.onDragStart} className={`flex h-12 items-center gap-1 rounded-2xl bg-foreground px-2 shadow-lg ${surface}`}>
        <span className="flex items-center gap-2 pr-1 pl-1 font-mono text-sm font-semibold tabular-nums">
          <span data-dot className={`size-2.5 rounded-full bg-danger ${status.paused ? "" : "animate-pulse"}`} />
          {status.maxMs === null ? (
            clock(status.elapsedMs)
          ) : (
            // The last 15 seconds before the limit stand out, so the reporter can wrap up.
            <span data-ending={status.maxMs - status.elapsedMs <= 15_000 || undefined} className="data-ending:text-warning">
              {`${clock(status.elapsedMs)} / ${clock(status.maxMs)}`}
            </span>
          )}
        </span>
        {status.errors > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-danger/20 px-2 py-0.5 text-xs font-semibold text-danger">
            <AlertIcon />
            {errorsText(status.errors)}
          </span>
        )}
        {divider}
        <Hint text={status.paused ? "Resume" : "Pause"}>
          <Button intent="plain" size="sq-sm" aria-label={status.paused ? "Resume" : "Pause"} onPress={status.paused ? props.onResume : props.onPause} className={onDark}>
            {status.paused ? <PlayIcon /> : <PauseIcon />}
          </Button>
        </Hint>
        <Hint text={micTitle}>
          <Toggle
            size="sq-sm"
            aria-label="Microphone"
            isSelected={status.micOn}
            isDisabled={!status.micAvailable}
            onChange={props.onMic}
            className={`${onDark} ${onDarkSelected}`}
          >
            {status.micOn ? <MicIcon /> : <MicOffIcon />}
          </Toggle>
        </Hint>
        <Hint text="Draw">
          <Toggle size="sq-sm" aria-label="Draw" isSelected={props.drawing} onChange={props.onDraw} className={`${onDark} ${onDarkSelected}`}>
            <PenIcon on={props.drawing} />
          </Toggle>
        </Hint>
        {divider}
        <Hint text="Restart">
          <Button intent="plain" size="sq-sm" aria-label="Restart" onPress={() => setConfirm("restart")} className={onDark}>
            <RestartIcon />
          </Button>
        </Hint>
        <Hint text="Discard">
          <Button intent="plain" size="sq-sm" aria-label="Discard" onPress={() => setConfirm("discard")} className={onDark}>
            <TrashIcon />
          </Button>
        </Hint>
        {divider}
        <Button size="sm" onPress={props.onStop}>
          <span aria-hidden className="size-2.5 rounded-[2px] bg-primary-foreground" />
          Stop
        </Button>
      </div>
    </div>
  )
}

/* Icons: Remix Icon's line variants, as on the dashboard; pause and play stay solid, as players draw them. */
const iconProps = { size: 16, "aria-hidden": true } as const

function PauseIcon() {
  return <RiPauseFill {...iconProps} />
}
function PlayIcon() {
  return <RiPlayFill {...iconProps} />
}
function MicIcon() {
  return <RiMicLine {...iconProps} />
}
function MicOffIcon() {
  return <RiMicOffLine {...iconProps} />
}
/** Filled while drawing is on. */
function PenIcon({ on = false }: { on?: boolean }) {
  return on ? <RiPencilFill {...iconProps} /> : <RiPencilLine {...iconProps} />
}
function RestartIcon() {
  return <RiRestartLine {...iconProps} />
}
function TrashIcon() {
  return <RiDeleteBinLine {...iconProps} />
}
function AlertIcon() {
  return <RiErrorWarningLine size={12} aria-hidden />
}
