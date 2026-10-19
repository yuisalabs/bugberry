import { Button } from "@bugberry/ui/button"
import { Menu, MenuHeader, MenuItem, MenuSection, MenuTrigger } from "@bugberry/ui/menu"
import { Radio, RadioField, RadioGroup } from "@bugberry/ui/radio"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
import {
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowUpSLine,
  RiCameraLine,
  RiComputerFill,
  RiComputerLine,
  RiInformationLine,
  RiLayoutGridLine,
  RiLayoutTopFill,
  RiLayoutTopLine,
  RiMicLine,
  RiMoreLine,
  RiTimerLine,
  RiVolumeUpLine,
  RiWindowFill,
  RiWindowLine,
} from "@remixicon/react"
import { type ReactNode, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import type { CapturePrefs, RecordSource } from "../../lib/capture-prefs"
import { canDelete, draftNote } from "../../lib/popup"
import type { RecordingStatus } from "../../lib/recording-flow"
import type { SessionState } from "../../lib/session"
import type { ReportDraft } from "../../lib/types"

export interface PopupViewProps {
  /** Undefined until the server has answered. */
  session: SessionState | undefined
  serverHost: string
  prefs: CapturePrefs
  micLabel: string
  screenshotShortcut: string | null
  /** Undefined until the background has answered. */
  recording: RecordingStatus | undefined
  drafts: ReportDraft[]
  /** False when the active tab isn't a web page: a screen or window recorded from it has no logs. */
  logsAvailable: boolean
  error: string | null
  busy: boolean
  onPrefs(patch: Partial<CapturePrefs>): void
  onMicToggle(on: boolean): void
  onScreenshot(): void
  onRecord(): void
  onSignIn(): void
  onRetry(): void
  onOpenSettings(): void
  onOpenDashboard(): void
  onOpenDraft(id: string): void
  onDeleteDraft(id: string): void
}

/** Each source's icon: the line variant, or the fill variant for the chosen one. */
const SOURCES: Array<{ id: RecordSource; label: string; icon(chosen: boolean): ReactNode }> = [
  { id: "tab", label: "This tab", icon: (chosen) => (chosen ? <RiLayoutTopFill {...small} /> : <RiLayoutTopLine {...small} />) },
  { id: "screen", label: "Screen", icon: (chosen) => (chosen ? <RiComputerFill {...small} /> : <RiComputerLine {...small} />) },
  { id: "window", label: "Window", icon: (chosen) => (chosen ? <RiWindowFill {...small} /> : <RiWindowLine {...small} />) },
]
const RECORD_LABEL: Record<RecordSource, string> = { tab: "Record tab", screen: "Record screen", window: "Record window" }

/** The toolbar popup: everything a reporter needs, one click away. No browser APIs here; App wires them. */
export function PopupView(props: PopupViewProps) {
  const [open, setOpen] = useState<"screenshot" | "record" | null>(null)
  const [showDrafts, setShowDrafts] = useState(false)

  if (showDrafts) return <DraftList {...props} onBack={() => setShowDrafts(false)} />

  const { session } = props
  const blocked = session?.kind === "signed-out" || session?.kind === "no-server"
  // Intent's Menu closes itself on a choice, a click elsewhere or Esc.
  const menuItems = [
    ...(props.drafts.length > 0
      ? [
          <MenuItem key="drafts" onAction={() => setShowDrafts(true)}>
            {`Unsent drafts (${props.drafts.length})`}
          </MenuItem>,
        ]
      : []),
    <MenuItem key="settings" onAction={props.onOpenSettings}>
      Settings
    </MenuItem>,
  ]
  return (
    <main className="flex flex-col gap-3 bg-background p-3 text-foreground">
      <header className="flex items-center justify-between pl-1">
        <span className="flex items-center gap-2">
          <img src="/assets/bugberry_logo_small.webp" alt="BugBerry" className="h-7 w-auto" />
        </span>
        <span className="flex items-center gap-1">
          <Button intent="plain" size="sq-sm" aria-label="Open dashboard" onPress={props.onOpenDashboard}>
            <GridIcon />
          </Button>
          <MenuTrigger>
            <Button intent="plain" size="sq-sm" aria-label="More">
              <DotsIcon />
            </Button>
            <Menu placement="bottom end" className="w-64">
              {session?.kind === "signed-in" ? (
                <MenuSection aria-label="Account">
                  <MenuHeader className="truncate py-1.5 text-xs font-normal text-muted-foreground sm:text-xs">
                    {`Signed in as ${session.name} · ${props.serverHost}`}
                  </MenuHeader>
                  {menuItems}
                </MenuSection>
              ) : (
                menuItems
              )}
            </Menu>
          </MenuTrigger>
        </span>
      </header>

      {session?.kind === "unreachable" && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
          <span>{`Can't reach ${session.host}`}</span>
          <AriaButton className="rounded-sm font-semibold underline outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onPress={props.onRetry}>
            Try again
          </AriaButton>
        </div>
      )}

      {session?.kind === "signed-out" && <StatusCard title="Sign in to BugBerry" action="Sign in" onAction={props.onSignIn} />}
      {session?.kind === "no-server" && <StatusCard title="Choose your BugBerry server" action="Open settings" onAction={props.onOpenSettings} />}

      {!blocked && (
        <>
          <Row
            icon={<CameraIcon />}
            label="Capture screenshot"
            extra={props.screenshotShortcut && <Kbd>{props.screenshotShortcut}</Kbd>}
            optionsLabel="Screenshot options"
            open={open === "screenshot"}
            disabled={props.busy}
            onMain={props.onScreenshot}
            onToggle={() => setOpen(open === "screenshot" ? null : "screenshot")}
          >
            <ScreenshotPanel {...props} />
          </Row>
          <Row
            icon={SOURCES.find((source) => source.id === props.prefs.recordSource)?.icon(false)}
            label={RECORD_LABEL[props.prefs.recordSource]}
            extra={<MicBadge on={props.prefs.mic} />}
            optionsLabel="Record options"
            open={open === "record"}
            disabled={props.busy}
            onMain={props.onRecord}
            onToggle={() => setOpen(open === "record" ? null : "record")}
          >
            <RecordPanel {...props} />
          </Row>
        </>
      )}

      {props.error && (
        <p role="alert" className="rounded-xl bg-danger-subtle px-3 py-2 text-sm text-danger-subtle-foreground">
          {props.error}
        </p>
      )}
    </main>
  )
}

function StatusCard({ title, action, onAction }: { title: string; action: string; onAction(): void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <p className="font-semibold">{title}</p>
      <Button size="sm" className="self-start" onPress={onAction}>
        {action}
      </Button>
    </section>
  )
}

/** A capture card: the action on the left and its options on the right, both React Aria buttons. */
function Row(props: {
  icon: ReactNode
  label: string
  extra: ReactNode
  optionsLabel: string
  open: boolean
  disabled: boolean
  onMain(): void
  onToggle(): void
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className={`flex h-[52px] overflow-hidden rounded-xl bg-background outline ${props.open ? "outline-primary" : "outline-border"}`}>
        <AriaButton
          isDisabled={props.disabled}
          onPress={props.onMain}
          className="flex flex-1 items-center gap-3 px-3.5 text-left outline-hidden hover:bg-muted focus-visible:bg-muted disabled:opacity-50"
        >
          <span className="grid size-[30px] place-items-center rounded-lg bg-muted text-foreground">{props.icon}</span>
          <span className="flex-1 text-[15px] font-semibold">{props.label}</span>
          {props.extra}
        </AriaButton>
        <AriaButton
          aria-label={props.optionsLabel}
          aria-expanded={props.open}
          onPress={props.onToggle}
          className={`grid w-11 place-items-center border-l border-border text-muted-foreground outline-hidden focus-visible:bg-muted ${props.open ? "bg-muted" : "hover:bg-muted"}`}
        >
          <ChevronIcon up={props.open} />
        </AriaButton>
      </div>
      {props.open && <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-3.5">{props.children}</div>}
    </section>
  )
}

function ScreenshotPanel({ prefs, onPrefs }: PopupViewProps) {
  const modes = [
    { id: "visible" as const, title: "Visible area", detail: "What you see on screen right now" },
    { id: "area" as const, title: "Select area", detail: "Drag to choose a part of the page" },
  ]
  return (
    <>
      <p className="text-xs font-medium text-muted-foreground">What to capture</p>
      <RadioGroup
        aria-label="What to capture"
        value={prefs.screenshotMode}
        onChange={(value) => onPrefs({ screenshotMode: value === "area" ? "area" : "visible" })}
        className="flex flex-col gap-2 space-y-0"
      >
        {modes.map((mode) => (
          <RadioField
            key={mode.id}
            value={mode.id}
            className={`flex rounded-[10px] bg-background px-2.5 py-2 outline ${prefs.screenshotMode === mode.id ? "outline-primary" : "outline-border"}`}
          >
            <Radio className="w-full">
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold">{mode.title}</span>
                <span className="text-xs font-normal text-muted-foreground">{mode.detail}</span>
              </span>
            </Radio>
          </RadioField>
        ))}
      </RadioGroup>
      <Note>Console and network logs from this tab are attached automatically.</Note>
    </>
  )
}

function RecordPanel({ prefs, micLabel, logsAvailable, onPrefs, onMicToggle }: PopupViewProps) {
  const source = prefs.recordSource
  const surface = source === "screen" ? "screen" : "window"
  return (
    <>
      <p className="text-xs font-medium text-muted-foreground">What to record</p>
      <ToggleGroup
        aria-label="What to record"
        size="sm"
        disallowEmptySelection
        selectedKeys={[source]}
        onSelectionChange={(keys) => {
          const [key] = keys
          if (key === "tab" || key === "screen" || key === "window") onPrefs({ recordSource: key })
        }}
        className="w-full bg-background"
      >
        {SOURCES.map((option) => (
          <ToggleGroupItem key={option.id} id={option.id} aria-label={option.label} className="flex-1 text-[13px]">
            {option.icon(option.id === source)}
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Toggle icon={<MicIcon />} label="Microphone" detail={micLabel} checked={prefs.mic} onChange={onMicToggle} />
      <Toggle icon={<TimerIcon />} label="3-second countdown" detail="" checked={prefs.countdown} onChange={(on) => onPrefs({ countdown: on })} />
      {source === "screen" && (
        <Toggle
          icon={<SpeakerIcon />}
          label="System audio"
          detail="Sound from apps and videos"
          checked={prefs.systemAudio}
          onChange={(on) => onPrefs({ systemAudio: on })}
        />
      )}
      {source !== "tab" && (
        <>
          <Note>{`Click “${RECORD_LABEL[source]}” and Chrome will ask which ${surface} to share.`}</Note>
          <Note>{logsAvailable ? "Console and network logs come from this tab only." : "Console and network logs aren't available on this page."}</Note>
        </>
      )}
    </>
  )
}

/** One recording option with an Intent Switch at the end. */
function Toggle(props: { icon: ReactNode; label: string; detail: string; checked: boolean; onChange(on: boolean): void }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-muted-foreground">{props.icon}</span>
      <span className="flex flex-1 flex-col">
        <span className="text-[13px] font-semibold">{props.label}</span>
        {props.detail && <span className="text-xs text-muted-foreground">{props.detail}</span>}
      </span>
      <SwitchField aria-label={props.label} isSelected={props.checked} onChange={props.onChange}>
        <Switch />
      </SwitchField>
    </div>
  )
}

function DraftList(props: PopupViewProps & { onBack(): void }) {
  return (
    <main className="flex flex-col gap-3 bg-background p-3 text-foreground">
      <header className="flex items-center gap-2">
        <Button intent="plain" size="sq-sm" aria-label="Back" onPress={props.onBack}>
          <ChevronIcon left />
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

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-1.5 text-xs text-muted-foreground">
      <InfoIcon />
      <span>{children}</span>
    </p>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{children}</span>
}

function MicBadge({ on }: { on: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${on ? "bg-primary-subtle text-primary" : "bg-muted text-muted-foreground"}`}
    >
      <MicIcon size={12} />
      {on ? "Mic on" : "Mic off"}
    </span>
  )
}

/* Icons: Remix Icon's line variants, as on the dashboard. */
const small = { size: 14, "aria-hidden": true } as const

function CameraIcon() {
  return <RiCameraLine size={16} aria-hidden />
}
function MicIcon({ size = 16 }: { size?: number }) {
  return <RiMicLine size={size} aria-hidden />
}
function SpeakerIcon() {
  return <RiVolumeUpLine size={16} aria-hidden />
}
function TimerIcon() {
  return <RiTimerLine size={16} aria-hidden />
}
function GridIcon() {
  return <RiLayoutGridLine size={16} aria-hidden />
}
function DotsIcon() {
  return <RiMoreLine size={16} aria-hidden />
}
function InfoIcon() {
  return (
    <span className="mt-px shrink-0">
      <RiInformationLine size={13} aria-hidden />
    </span>
  )
}
function ChevronIcon({ up = false, left = false }: { up?: boolean; left?: boolean }) {
  const Chevron = left ? RiArrowLeftSLine : up ? RiArrowUpSLine : RiArrowDownSLine
  return <Chevron size={16} aria-hidden />
}
