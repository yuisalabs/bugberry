import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCameraLine,
  RiComputerLine,
  RiDragDropLine,
  RiFullscreenLine,
  RiLayoutTopLine,
  RiMicLine,
  RiMicOffLine,
  RiPictureInPictureLine,
  RiTimerLine,
  RiVolumeUpLine,
} from "@remixicon/react"
import { type ReactNode, type RefObject, useSyncExternalStore } from "react"
import { Button as AriaButton, Radio, RadioGroup, ToggleButton } from "react-aria-components"
import type { CapturePrefs, RecordSource, ScreenshotMode } from "../../lib/capture-prefs"
import { type CaptureChoice, captureCopy } from "../../lib/popup"
import { Dial, InfoBox, SectionLabel } from "./parts"
import type { LevelSource } from "./PopupView"

const icon = { size: 18, "aria-hidden": true } as const

const SHOTS: Array<{ id: ScreenshotMode; label: string; icon: ReactNode }> = [
  { id: "visible", label: "Visible area", icon: <RiFullscreenLine {...icon} /> },
  { id: "area", label: "Select area", icon: <RiDragDropLine {...icon} /> },
]
const SOURCES: Array<{ id: RecordSource; label: string; icon: ReactNode }> = [
  { id: "tab", label: "Tab", icon: <RiLayoutTopLine {...icon} /> },
  { id: "screen", label: "Screen", icon: <RiComputerLine {...icon} /> },
  { id: "window", label: "Window", icon: <RiPictureInPictureLine {...icon} /> },
]

/** A tile: grey outline, or pink outline and tint once chosen. While recording they are all faded. */
function tileClass({ isSelected, isFocusVisible, isDisabled }: { isSelected: boolean; isFocusVisible: boolean; isDisabled: boolean }) {
  return [
    "flex h-[46px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border text-sm font-semibold outline-hidden transition-colors",
    isSelected
      ? "border-primary bg-primary/[0.04] text-primary shadow-[inset_0_0_0_1px_var(--primary)]"
      : "border-border bg-background text-foreground hover:bg-muted",
    isFocusVisible ? "ring-2 ring-ring/40" : "",
    isDisabled ? "cursor-default opacity-45 hover:bg-background" : "",
  ].join(" ")
}

/** The two rows of tiles. Exactly one tile across both is chosen; choosing only chooses, the dial acts. */
export function Tiles(props: {
  choice: CaptureChoice
  tabRecorder: boolean
  disabled?: boolean
  onChoose(patch: Partial<CapturePrefs>): void
}) {
  const { choice } = props
  const sources = SOURCES.filter((source) => props.tabRecorder || source.id !== "tab")
  return (
    <div className="flex flex-col gap-2 px-3.5 pt-1 pb-3.5">
      <SectionLabel>Screenshot</SectionLabel>
      <RadioGroup
        aria-label="Screenshot"
        orientation="horizontal"
        isDisabled={props.disabled}
        value={choice.kind === "screenshot" ? choice.mode : null}
        onChange={(value) => props.onChoose({ captureKind: "screenshot", screenshotMode: value === "area" ? "area" : "visible" })}
        className="flex gap-2"
      >
        {SHOTS.map((shot) => (
          <Radio key={shot.id} value={shot.id} className={tileClass}>
            {shot.icon}
            {shot.label}
          </Radio>
        ))}
      </RadioGroup>
      <span className="mt-2">
        <SectionLabel>Record</SectionLabel>
      </span>
      <RadioGroup
        aria-label="Record"
        orientation="horizontal"
        isDisabled={props.disabled}
        value={choice.kind === "record" ? choice.source : null}
        onChange={(value) => {
          if (value === "tab" || value === "screen" || value === "window") props.onChoose({ captureKind: "record", recordSource: value })
        }}
        className="flex gap-2"
      >
        {sources.map((source) => (
          <Radio key={source.id} value={source.id} className={tileClass}>
            {source.icon}
            {source.label}
          </Radio>
        ))}
      </RadioGroup>
    </div>
  )
}

/** A rounded chip under the dial: pink when on, white with an outline when off. */
const chip = (on: boolean) =>
  `flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-semibold outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 ${
    on ? "bg-primary-subtle text-primary" : "border border-border bg-background text-muted-foreground hover:bg-muted"
  }`

/** The lower panel before anything runs: the dial, its caption, the chips and the note. */
export function CaptureControls(props: {
  choice: CaptureChoice
  prefs: CapturePrefs
  tabRecorder: boolean
  /** The chosen microphone's short name; null when the microphone is off. */
  micShort: string | null
  micOpen: boolean
  busy: boolean
  /** The microphone chip's level bars. */
  level: LevelSource
  onPrefs(patch: Partial<CapturePrefs>): void
  onMicChip(): void
  onScreenshot(): void
  onRecord(): void
  /** The picker, drawn above the chips. */
  picker?: ReactNode
  chipRef?: RefObject<HTMLButtonElement | null>
}) {
  const { choice, prefs } = props
  const copy = captureCopy(choice, props.micShort, true)
  const recording = choice.kind === "record"
  return (
    <div className="flex flex-col items-center px-4 pt-5 pb-4">
      <Dial label={copy.caption} tone="primary" disabled={props.busy} onPress={recording ? props.onRecord : props.onScreenshot}>
        {recording ? <span aria-hidden className="size-[26px] rounded-full bg-primary-foreground" /> : <RiCameraLine size={30} aria-hidden />}
      </Dial>
      <p aria-hidden className="mt-3 font-heading text-lg font-bold text-foreground">
        {copy.caption}
      </p>
      {recording && (
        <div className="relative mt-3 flex flex-wrap items-center justify-center gap-2">
          {props.picker}
          <AriaButton ref={props.chipRef} aria-expanded={props.micOpen} onPress={props.onMicChip} className={`${chip(props.micShort !== null)} ${props.micOpen ? "ring-[1.5px] ring-primary" : ""}`}>
            {props.micShort !== null ? <RiMicLine size={16} aria-hidden /> : <RiMicOffLine size={16} aria-hidden />}
            <span className={`max-w-[120px] truncate ${props.micShort !== null ? "" : "text-foreground/80"}`}>{props.micShort ?? "Mic off"}</span>
            {props.micShort !== null && <LevelBars level={props.level} />}
            {props.micOpen ? <RiArrowUpSLine size={16} aria-hidden /> : <RiArrowDownSLine size={16} aria-hidden />}
          </AriaButton>
          <ToggleButton isSelected={prefs.countdown} onChange={(on) => props.onPrefs({ countdown: on })} className={chip(prefs.countdown)}>
            <RiTimerLine size={16} aria-hidden />
            {choice.source === "screen" && props.tabRecorder ? "3s" : "3s countdown"}
          </ToggleButton>
          {choice.source === "screen" && props.tabRecorder && (
            <ToggleButton isSelected={prefs.systemAudio} onChange={(on) => props.onPrefs({ systemAudio: on })} className={chip(prefs.systemAudio)}>
              <RiVolumeUpLine size={16} aria-hidden />
              System audio
            </ToggleButton>
          )}
        </div>
      )}
      {copy.info && (
        <div className="mt-3 w-full">
          <InfoBox>{copy.info}</InfoBox>
        </div>
      )}
    </div>
  )
}

/** Four bars, lit from the left as the microphone hears something. Only they re-render as the level moves. */
export function LevelBars({ level: source }: { level: LevelSource }) {
  const level = useSyncExternalStore(source.subscribe, source.get)
  const lit = Math.ceil(Math.min(1, Math.max(0, level)) * 4)
  return (
    <span aria-hidden className="flex h-3.5 items-end gap-[2px]">
      {[5, 8, 11, 14].map((height, index) => (
        <span key={height} data-level-bar={index < lit ? "on" : "off"} style={{ height }} className={`w-[3px] rounded-full ${index < lit ? "bg-primary" : "bg-primary/25"}`} />
      ))}
    </span>
  )
}
