import { Button } from "@bugberry/ui/button"
import { Menu, MenuHeader, MenuItem, MenuSection, MenuTrigger } from "@bugberry/ui/menu"
import { RiArrowRightUpLine, RiFunctionLine, RiMoreLine, RiSettings3Line } from "@remixicon/react"
import { type ReactNode, useCallback, useRef, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import type { CapturePrefs } from "../../lib/capture-prefs"
import type { CameraAccess, CameraDevice } from "../../lib/camera"
import type { MicAccess, MicDevice } from "../../lib/microphone"
import { type CaptureChoice, captureCopy, choiceOf } from "../../lib/popup"
import type { PopupRecordingStatus, RecordingStatus } from "../../lib/recording-flow"
import type { SessionState } from "../../lib/server/session"
import type { ReportDraft } from "../../lib/types"
import { CaptureControls, Tiles } from "./CapturePanel"
import { DraftList } from "./DraftList"
import { RecordingPanel } from "./RecordingPanel"
import { CameraPicker } from "./CameraPicker"
import { MicPicker } from "./MicPicker"
import { Footer } from "./parts"

/** The metered microphone's loudness, 0..1. Only the level bars subscribe, so the rest of the popup stays put. */
export interface LevelSource {
  get(): number
  subscribe(listener: () => void): () => void
}

/** The microphones as the popup knows them. */
export interface MicState extends MicList {
  level: LevelSource
}

/** The microphones without their level. */
export interface MicList {
  access: MicAccess
  devices: MicDevice[]
  defaultId: string | null
}

export interface PopupViewProps {
  /** Undefined until the server has answered. */
  session: SessionState | undefined
  serverHost: string
  prefs: CapturePrefs
  mic: MicState
  /** Undefined until the background has answered; used by the drafts list. */
  recording: RecordingStatus | undefined
  /** The running recording as the popup shows it; undefined until the background has answered. */
  live: PopupRecordingStatus | undefined
  activeTabId: number | null
  drafts: ReportDraft[]
  /** False when the active tab isn't a web page: a screen or window recorded from it has no logs. */
  logsAvailable: boolean
  /** False in Firefox: no "Tab" tile and no system audio; the browser's picker chooses a screen or window. */
  tabRecorder: boolean
  /** False when the reporter took away BugBerry's access to websites (Firefox lets them). */
  hostAccess: boolean
  error: string | null
  busy: boolean
  onPrefs(patch: Partial<CapturePrefs>): void
  /** null is "No microphone". */
  onMicChoose(id: string | null): void
  onMicAllow(): void
  onMicPicker(open: boolean): void
  /** The cameras as the popup knows them. */
  camera: { access: CameraAccess; devices: CameraDevice[] }
  /** null is "No camera". */
  onCameraChoose(id: string | null): void
  onCameraAllow(): void
  onScreenshot(): void
  onRecord(): void
  onPause(): void
  onResume(): void
  onRestart(): void
  onDiscard(): void
  onStop(): void
  onSignIn(): void
  onRetry(): void
  onOpenSettings(): void
  onOpenDashboard(): void
  onOpenDraft(id: string): void
  onDeleteDraft(id: string): void
  onAllowHosts(): void
  /** The default workspace's usage under ACCOUNT_LIMITS ("Screenshots 3/5 · Recordings 5/5"); null without limits. */
  usage?: string | null
  /** Shown under the tiles when the chosen kind is full; the dial still works (the report may go to another workspace). */
  screenshotWarning?: string | null
  recordWarning?: string | null
}

/** The device recorded from: the chosen one, or the default one when it is unplugged or none was chosen. */
function micInUse(prefs: CapturePrefs, mic: MicList) {
  return mic.devices.find((device) => device.id === prefs.micDeviceId) ?? mic.devices.find((device) => device.id === mic.defaultId)
}

/** The chosen microphone's short name for the chip and the note; null while it is off, or when there is none to record from. */
export function micShortName(prefs: CapturePrefs, mic: MicList): string | null {
  return prefs.mic ? (micInUse(prefs, mic)?.short ?? null) : null
}

/** The device whose level the popup shows: the one in use, or the default one while the microphone is off. */
export function meteredMicId(prefs: CapturePrefs, mic: MicList): string | null {
  return prefs.mic ? (micInUse(prefs, mic)?.id ?? mic.defaultId) : mic.defaultId
}

/**
 * Whether the popup listens to the microphone for its level bars: only where they show (a record tile's
 * chip, or the open picker), never during a recording, and only once the microphone may be used. Opening
 * the microphone lights the system's mic indicator, so it stays off whenever nothing on screen needs it.
 */
export function micMeterOn(
  prefs: CapturePrefs,
  mic: MicList,
  pickerOpen: boolean,
  live: PopupRecordingStatus | undefined,
  tabRecorder: boolean,
): boolean {
  if (mic.access !== "granted" || live === undefined || live.recording) return false
  return choiceOf(prefs, tabRecorder).kind === "record" && (pickerOpen || prefs.mic)
}

/**
 * The chosen camera, when it is still there. Otherwise the bubble opens the system's default camera, which
 * Chrome doesn't name: the chip says "Default camera".
 */
function cameraInUse(prefs: CapturePrefs, camera: PopupViewProps["camera"]) {
  return camera.devices.find((device) => device.id === prefs.cameraDeviceId)
}

/** The toolbar popup: tiles to choose what to capture, a dial to do it. No browser APIs here; App wires them. */
export function PopupView(props: PopupViewProps) {
  const [showDrafts, setShowDrafts] = useState(false)
  const [micOpen, setMicOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const { onMicPicker } = props
  const toggleMic = useCallback(
    (open: boolean) => {
      setMicOpen(open)
      onMicPicker(open)
    },
    [onMicPicker],
  )
  const closeMic = useCallback(() => toggleMic(false), [toggleMic])
  const [cameraOpen, setCameraOpen] = useState(false)
  const cameraChipRef = useRef<HTMLButtonElement>(null)
  const closeCamera = useCallback(() => setCameraOpen(false), [])

  if (showDrafts) return <DraftList {...props} onBack={() => setShowDrafts(false)} />

  const { session, prefs } = props
  // Signed out, captures still work: they wait as drafts until the reporter signs in to send them.
  const blocked = session?.kind === "no-server"
  const live = props.live?.recording ? props.live : null
  // While recording the tiles show what is being recorded, faded: nothing else can start.
  const choice: CaptureChoice = live ? { kind: "record", source: live.source } : choiceOf(prefs, props.tabRecorder)
  const logsOn = props.logsAvailable && props.hostAccess
  const micShort = micShortName(prefs, props.mic)
  // The camera's bubble is on the page: only a tab recording shows it.
  const cameraShown = choice.kind === "record" && choice.source === "tab" && props.tabRecorder
  const cameraName = prefs.camera ? (cameraInUse(prefs, props.camera)?.name ?? "Default camera") : null
  const warning = choice.kind === "screenshot" ? props.screenshotWarning : props.recordWarning

  return (
    <main className="flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-3.5 pt-3 pb-2">
        <img src="/assets/bugberry_logo_small.webp" alt="BugBerry" className="h-7 w-auto" />
        <span className="flex items-center gap-1">
          <Button intent="plain" size="sq-sm" aria-label="Open dashboard" onPress={props.onOpenDashboard}>
            <RiFunctionLine size={18} aria-hidden />
          </Button>
          <AccountMenu {...props} onShowDrafts={() => setShowDrafts(true)} />
        </span>
      </header>

      {session?.kind === "unreachable" && (
        <Strip tone="warning">
          <span className="flex items-center justify-between gap-2">
            <span>{`Can't reach ${session.host}`}</span>
            <AriaButton className="rounded-sm font-semibold underline outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onPress={props.onRetry}>
              Try again
            </AriaButton>
          </span>
        </Strip>
      )}
      {!props.hostAccess && (
        <Strip tone="warning">
          <span className="flex flex-col gap-2">
            <span>BugBerry can't read this page. Allow access to websites to capture logs.</span>
            <Button size="sm" className="self-start" onPress={props.onAllowHosts}>
              Allow access to websites
            </Button>
          </span>
        </Strip>
      )}

      {!live && session?.kind === "signed-out" && (
        <Strip tone="warning">
          <span className="flex items-center justify-between gap-2">
            <span>Sign in to send your captures to BugBerry</span>
            <Button size="sm" onPress={props.onSignIn}>
              Sign in
            </Button>
          </span>
        </Strip>
      )}

      {live && (
        <>
          <Tiles choice={choice} tabRecorder={props.tabRecorder} disabled onChoose={props.onPrefs} />
          {props.error && (
            <Strip tone="danger" alert>
              {props.error}
            </Strip>
          )}
          <section className="border-t border-border bg-muted">
            <RecordingPanel
              live={live}
              activeTabId={props.activeTabId}
              onPause={props.onPause}
              onResume={props.onResume}
              onRestart={props.onRestart}
              onDiscard={props.onDiscard}
              onStop={props.onStop}
            />
            <Footer text={live.logs ? "Capturing console and network live" : "Logs aren't available on this page"} logsOn={live.logs} />
          </section>
        </>
      )}

      {/* Until the background says whether a recording runs, nothing can be pressed by mistake. */}
      {!props.live && !blocked && (
        <>
          <Tiles choice={choice} tabRecorder={props.tabRecorder} disabled onChoose={props.onPrefs} />
          <section aria-busy className="h-[260px] border-t border-border bg-muted" />
        </>
      )}

      {!live && session?.kind === "no-server" && <StatusCard title="Choose your BugBerry server" action="Open settings" onAction={props.onOpenSettings} />}

      {props.live && !live && !blocked && (
        <>
          <Tiles choice={choice} tabRecorder={props.tabRecorder} onChoose={props.onPrefs} />
          {warning && <Strip tone="warning">{warning}</Strip>}
          {props.error && (
            <Strip tone="danger" alert>
              {props.error}
            </Strip>
          )}
          <section className="border-t border-border bg-muted">
            <CaptureControls
              choice={choice}
              prefs={prefs}
              tabRecorder={props.tabRecorder}
              micShort={micShort}
              micOpen={micOpen}
              busy={props.busy}
              level={props.mic.level}
              onPrefs={props.onPrefs}
              onMicChip={() => {
                setCameraOpen(false)
                toggleMic(!micOpen)
              }}
              camera={
                cameraShown
                  ? {
                      short: cameraName,
                      open: cameraOpen,
                      chipRef: cameraChipRef,
                      onChip: () => {
                        if (micOpen) toggleMic(false)
                        setCameraOpen(!cameraOpen)
                      },
                    }
                  : undefined
              }
              onScreenshot={props.onScreenshot}
              onRecord={props.onRecord}
              chipRef={chipRef}
              picker={
                (cameraShown && cameraOpen && (
                  <CameraPicker
                    access={props.camera.access}
                    devices={props.camera.devices}
                    // "" while on with the default camera: no row is picked, the shape still shows.
                    chosen={prefs.camera ? (cameraInUse(prefs, props.camera)?.id ?? "") : null}
                    shape={prefs.cameraShape}
                    chipRef={cameraChipRef}
                    onChoose={(id) => {
                      props.onCameraChoose(id)
                      closeCamera()
                    }}
                    onShape={(shape) => props.onPrefs({ cameraShape: shape })}
                    onAllow={props.onCameraAllow}
                    onClose={closeCamera}
                  />
                )) ||
                (micOpen && (
                  <MicPicker
                    access={props.mic.access}
                    devices={props.mic.devices}
                    chosen={prefs.mic ? (micInUse(prefs, props.mic)?.id ?? null) : null}
                    metered={meteredMicId(prefs, props.mic)}
                    level={props.mic.level}
                    chipRef={chipRef}
                    onChoose={(id) => {
                      props.onMicChoose(id)
                      closeMic()
                    }}
                    onAllow={props.onMicAllow}
                    onClose={closeMic}
                  />
                ))
              }
            />
            <Footer text={captureCopy(choice, micShort, logsOn).footer} logsOn={logsOn} />
          </section>
        </>
      )}
      {!live && blocked && props.error && (
        <Strip tone="danger" alert>
          {props.error}
        </Strip>
      )}
    </main>
  )
}

/** The ⋯ menu: who is signed in and where, the usage, the unsent drafts and Settings. */
function AccountMenu(props: PopupViewProps & { onShowDrafts(): void }) {
  const { session } = props
  return (
    <MenuTrigger>
      <Button intent="plain" size="sq-sm" aria-label="More">
        <RiMoreLine size={18} aria-hidden />
      </Button>
      <Menu placement="bottom end" className="w-64">
        <MenuSection aria-label="Account">
          {session?.kind === "signed-in" && (
            <MenuHeader separator className="flex items-center gap-3 py-2.5">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-foreground font-heading text-base font-bold text-background">
                {session.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-xs font-normal text-muted-foreground">Signed in as</span>
                <span className="truncate text-sm font-semibold">{session.name}</span>
                <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
                  <span className="truncate font-mono">{props.serverHost}</span>
                </span>
              </span>
            </MenuHeader>
          )}
          {props.usage ? <MenuHeader className="py-1.5 text-xs font-normal text-muted-foreground">{props.usage}</MenuHeader> : null}
          {props.drafts.length > 0 ? (
            <MenuItem textValue={`Unsent drafts (${props.drafts.length})`} onAction={props.onShowDrafts}>
              {`Unsent drafts (${props.drafts.length})`}
            </MenuItem>
          ) : null}
          <MenuItem textValue="Settings" onAction={props.onOpenSettings} className="bg-muted/70">
            <span className="flex w-full items-center gap-2">
              <RiSettings3Line size={16} aria-hidden className="text-muted-foreground" />
              <span className="flex-1">Settings</span>
              <RiArrowRightUpLine size={16} aria-hidden className="text-muted-foreground" />
            </span>
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  )
}

function StatusCard({ title, action, onAction }: { title: string; action: string; onAction(): void }) {
  return (
    <section className="mx-3.5 mt-1 mb-3.5 flex flex-col gap-3 rounded-xl border border-border p-4">
      <p className="font-heading font-semibold">{title}</p>
      <Button size="sm" className="self-start" onPress={onAction}>
        {action}
      </Button>
    </section>
  )
}

function Strip({ tone, alert = false, children }: { tone: "warning" | "danger"; alert?: boolean; children: ReactNode }) {
  const colors = tone === "warning" ? "bg-warning-subtle text-warning-subtle-foreground" : "bg-danger-subtle text-danger-subtle-foreground"
  return (
    <div role={alert ? "alert" : undefined} className={`mx-3.5 mb-3 rounded-xl px-3 py-2 text-[13px] ${colors}`}>
      {children}
    </div>
  )
}
