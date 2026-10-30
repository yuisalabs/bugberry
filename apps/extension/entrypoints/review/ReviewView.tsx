import type { RecordingNote } from "@bugberry/capture"
import { matchProject, type Visibility } from "@bugberry/shared"
import { Button } from "@bugberry/ui/button"
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { RiCameraLine, RiCloseLine, RiCursorLine, RiDeleteBinLine, RiGlobalLine, RiTerminalBoxLine, RiVideoOnLine, RiWindowLine } from "@remixicon/react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import type { TemplateText } from "@bugberry/ai-write"
import type { AiPath } from "../../lib/ai/ai-assist"
import { useAutoGrow } from "../../lib/shared/auto-grow"
import type { Project, Workspace } from "../../lib/server/api"
import { useUnobscured } from "../../lib/prompts/prompt-page"
import { formProblem } from "../../lib/review/report-form"
import { isTrimmed, reviewStats, suggestTitle, type TrimRange, trimPayload } from "../../lib/review/review-data"
import type { ReportDraft } from "../../lib/shared/types"
import type { ReportForm, SentReport, UploadProgress } from "../../lib/review/upload"
import { PreparingBar, Tile, UploadBar } from "./parts"
import { ReportFields } from "./ReportFields"
import { SentPanel, type SentDetails, type TrackerChoice } from "./SentPanel"
import { TrimStrip } from "./TrimStrip"

export type ReviewStatus =
  | "ready"
  | "sending"
  | { failed: string }
  /** The dashboard session ended while sending. */
  | { signedOut: string }
  | { sent: SentReport }
  /** The trimmed video couldn't be made; the reporter may send the full one instead. */
  | { trimFailed: string }

/** Someone a report can be assigned to. */
export interface Assignable {
  id: string
  name: string
  email: string
}

export interface ReviewViewProps {
  /** Over the recorded page (an iframe) rather than in a tab of its own. */
  embedded: boolean
  draft: ReportDraft
  /** The video player or the annotation canvas; the page builds it. */
  media: ReactNode
  /** The screenshot's size in pixels, shown next to its kind. */
  mediaSize?: { width: number; height: number } | null
  workspaces: Workspace[]
  workspaceId: string | null
  /** Set when not signed in: the capture is kept as a draft, and this sign-in page comes before sending. */
  signInUrl?: string | null
  projects: Project[]
  /** The selected workspace's members, for Assignee. */
  members?: Assignable[]
  email: string | null
  /** The signed-in person's name: an untitled report is "Bugshoot by <name>" or "Bugcord by <name>". */
  name: string | null
  status: ReviewStatus
  /** While sending: how much of the report's files has gone up; null before the first bytes are counted. */
  uploadProgress?: UploadProgress | null
  includeCity: boolean
  cityNote: string | null
  /** `fullVideo`: send the whole recording although it is trimmed (after the trimmed one couldn't be made). */
  onSend(form: ReportForm, notes: RecordingNote[], options?: { fullVideo?: boolean }): void
  onDiscard(): void
  onAgain(): void
  /** `kept`: save these into the draft before closing; null after sending. */
  onClose(kept: { form: ReportForm; notes: RecordingNote[] } | null): void
  onWorkspaceChange(id: string): void
  /** The selected workspace's usage for this kind under ACCOUNT_LIMITS ("Recordings 5/5"); null without limits. */
  usage?: string | null
  /** Set when the selected workspace is full for this kind. */
  limitWarning?: string | null
  /** "Create report" waits for a free slot (never while resuming this draft's own upload). */
  sendBlocked?: boolean
  /** The untrimmed recording is longer than the workspace takes, so "Send full video" isn't offered. */
  fullVideoTooLong?: boolean
  /** Admins only: opens the dashboard on this workspace to delete a report. */
  onOpenDashboard?(): void
  onIncludeCityChange(on: boolean): void
  /** Every edit, so the draft keeps it even when the tab closes without "Keep". */
  onChange(form: ReportForm, notes: RecordingNote[]): void
  /** After sending: the created report as the server has it. */
  sentDetails?: SentDetails | null
  /** After sending: the project's trackers; null while loading or when there are none to offer. */
  trackers?: TrackerChoice[] | null
  /** After sending, when no tracker can be offered: why. */
  trackerNote?: string | null
  onVisibilityChange?(visibility: Visibility): void
  /** Write with AI (video drafts only): which key writes, the workspace's templates and each project's default. */
  ai?: {
    path: AiPath
    templates: Array<{ id: string; name: string } & TemplateText>
    templateFor(projectId: string | null): string | null
    isAdmin: boolean
    /** The dashboard's Settings → AI, for an admin without a key. */
    settingsUrl: string
    /** Why the workspace's AI settings couldn't load (not an older server, which has none). */
    error?: string | null
  } | null
  /** After sending: the report has no project, so it has no trackers until one is picked. */
  needsProject?: boolean
  /** Moves the sent report into a project; its trackers are offered then. */
  onPickProject?(projectId: string): Promise<void> | void
  /** Loads the AI settings again after they failed to load. */
  onAiRetry?(): void
  /** Drafts a title and description; rejects with the text to show. */
  onAiWrite?(input: { templateId: string; hint: { title: string; description: string } }): Promise<{ title: string; description: string }>
  onSendToTracker?(integrationId: string): void
  /** After sending: a new capture of the same kind on the same page. */
  onAnother?(): void
  /** Videos: the part that is sent (video time); null or absent sends it all. */
  trim?: TrimRange | null
  /** Videos: a send has started, so the trim can't change any more. */
  trimLocked?: boolean
  /** Videos: frames for the Trim strip; empty until they are made. */
  trimFrames?: string[]
  /** Each move of a Trim handle, and Reset; null when the whole video is kept. */
  onTrimChange?(range: TrimRange | null): void
  /** While a Trim handle moves: the moment to show in the player. */
  onTrimPreview?(ms: number): void
  /** The playhead was moved, anywhere in the video (ms). */
  onTrimSeek?(ms: number): void
  /** Where the player is (ms), for the strip's playhead. */
  trimPosition?: number
  /** Whether the player is playing, for the strip's play button. */
  trimPlaying?: boolean
  /** The strip's play button: plays the part being kept, or pauses. */
  onTrimPlay?(): void
  /** While sending a trimmed video: how far its encoding is (0–1); null otherwise. */
  preparing?: number | null
}

/**
 * The review modal: the capture on the left (the annotation canvas or the player, and what the logs caught), the
 * report on the right. Once sent, the right side shows the created report and its link, still over the page.
 */
export function ReviewView(props: ReviewViewProps) {
  const { draft } = props
  const events = draft.debuggerPayload?.events ?? []
  const suggestion = useState(() => suggestTitle(events))[0]
  const [form, setForm] = useState<ReportForm>(
    () =>
      draft.form ?? {
        workspaceId: props.workspaceId ?? undefined,
        projectId: matchProject(props.projects, draft.page.url)?.id ?? "",
        title: suggestion?.title ?? "",
        description: "",
        priority: "none",
        visibility: "workspace",
      },
  )
  const [titleEdited, setTitleEdited] = useState(Boolean(draft.form))
  const [notes, setNotes] = useState<RecordingNote[]>(() => draft.debuggerPayload?.notes ?? [])
  const [confirm, setConfirm] = useState<"discard" | "again" | "close" | null>(null)
  // What the dialog asks, kept while it fades out after Cancel, so its text doesn't switch to another question.
  const lastAsked = useRef<"discard" | "again" | "close">("discard")
  if (confirm) lastAsked.current = confirm
  const asked = confirm ?? lastAsked.current
  const [problem, setProblem] = useState<string | null>(null)
  const update = (changes: Partial<ReportForm>) => setForm((current) => ({ ...current, ...changes }))
  // The title wraps onto more lines instead of running off; the description scrolls inside its own space.
  const titleField = useAutoGrow(form.title)
  // Write with AI: the template follows the project's default until the reporter picks one; Undo brings back what
  // was typed before, until either field is edited again.
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null)
  const ai = props.ai ?? null
  const aiTemplate =
    pickedTemplate && ai?.templates.some((template) => template.id === pickedTemplate) ? pickedTemplate : (ai?.templateFor(form.projectId || null) ?? null)
  const [writing, setWriting] = useState(false)
  const writingNow = useRef(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ title: string; description: string } | null>(null)
  // Over a page, a click on Write with AI counts only while nothing of the page covers the review. The row appears
  // once the AI settings have loaded, after the first render, so the check follows the element as it mounts.
  const [aiRowElement, setAiRowElement] = useState<HTMLDivElement | null>(null)
  const aiRow = useMemo(() => ({ current: aiRowElement }), [aiRowElement])
  const aiSeen = useUnobscured(aiRow, props.embedded)
  const writeWithAi = async () => {
    if (writingNow.current || !aiSeen || !props.onAiWrite || !aiTemplate) return
    writingNow.current = true
    setWriting(true)
    setAiError(null)
    const before = { title: form.title, description: form.description }
    try {
      const written = await props.onAiWrite({ templateId: aiTemplate, hint: before })
      setTitleEdited(true)
      update({ title: written.title, description: written.description })
      setUndo(before)
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      writingNow.current = false
      setWriting(false)
    }
  }
  // Edits go up as they happen (not on the first render), so a closed tab or page doesn't lose them.
  const edited = useRef(false)
  const { onChange } = props
  useEffect(() => {
    if (edited.current) onChange(form, notes)
    edited.current = true
  }, [form, notes, onChange])

  const isVideo = draft.captureType === "video"
  const durationMs = draft.captureType === "video" ? (draft.durationMs ?? 0) : 0
  const startedAt = draft.captureType === "video" ? (draft.recordingStartedAt ?? draft.debuggerPayload?.recordingStartedAt ?? 0) : 0
  const trim = isTrimmed(props.trim, durationMs) ? props.trim : null
  const stats = reviewStats(trim && draft.debuggerPayload ? trimPayload(draft.debuggerPayload, startedAt, trim).events : events)
  // The strip's range, kept here as well so a handle moves smoothly; a new trim from the page (after "Send full
  // video", say) replaces it.
  const whole = { startMs: 0, endMs: durationMs }
  const [range, setRange] = useState<TrimRange>(() => trim ?? whole)
  useEffect(() => setRange(trim ?? { startMs: 0, endMs: durationMs }), [trim?.startMs, trim?.endMs, durationMs])
  const changeRange = (next: TrimRange) => {
    setRange(next)
    props.onTrimChange?.(isTrimmed(next, durationMs) ? next : null)
  }
  const sending = props.status === "sending"
  const sent = typeof props.status === "object" && "sent" in props.status ? props.status.sent : null

  const send = (options?: { fullVideo?: boolean }) => {
    if (props.sendBlocked) return
    const values = { ...form, workspaceId: form.workspaceId ?? props.workspaceId ?? undefined }
    const found = formProblem(values)
    setProblem(found)
    if (!found) props.onSend(values, notes, options)
  }
  const close = () => (sent ? props.onClose(null) : setConfirm("close"))

  const shell = props.embedded
    ? "fixed inset-0 flex items-center justify-center bg-foreground/45 p-4 sm:p-6"
    : "flex min-h-screen items-center justify-center bg-muted p-4 sm:p-6"
  const kind = isVideo ? "Video" : "Screenshot"
  const KindIcon = isVideo ? RiVideoOnLine : RiCameraLine

  return (
    <div className={shell}>
      <section
        role="dialog"
        aria-label={sent ? "Report created" : "Review your report"}
        className="relative grid max-h-full w-full max-w-[min(112rem,96vw)] overflow-y-auto rounded-3xl lg:overflow-hidden bg-overlay text-overlay-foreground shadow-2xl ring ring-muted-foreground/25 lg:h-[min(60rem,100%)] lg:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)]"
      >
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-5 sm:p-7">
          <header className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-3">
              <Button intent="outline" size="sq-sm" aria-label="Close" onPress={close}>
                <RiCloseLine aria-hidden />
              </Button>
              <img src="/assets/bugberry_logo_small.webp" alt="BugBerry" className="h-7 w-auto object-contain" />
            </span>
            <span className="flex items-center gap-2 rounded-full px-1.5 py-1.5 text-sm ring-1 ring-border">
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary">
                <KindIcon size={14} aria-hidden />
              </span>
              <span className="font-semibold">{kind}</span>
              {!isVideo && props.mediaSize && (
                <span className="text-muted-foreground">
                  · {props.mediaSize.width} × {props.mediaSize.height}
                </span>
              )}
            </span>
          </header>

          <div className="flex min-h-64 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-muted p-4 sm:p-6">
            <div className={isVideo ? "w-full overflow-hidden rounded-xl bg-foreground shadow-lg" : "flex h-full w-full items-center justify-center"}>{props.media}</div>
          </div>

          {isVideo && !sent && (
            <div className="flex flex-col gap-2">
              <TrimStrip
                durationMs={durationMs}
                value={range}
                frames={props.trimFrames ?? []}
                positionMs={props.trimPosition ?? 0}
                playing={props.trimPlaying ?? false}
                disabled={Boolean(props.trimLocked) || sending}
                onChange={changeRange}
                onPreview={(ms) => props.onTrimPreview?.(ms)}
                onSeek={(ms) => props.onTrimSeek?.(ms)}
                onPlay={() => props.onTrimPlay?.()}
                onReset={() => changeRange(whole)}
              />
              {props.trimLocked && <span className="text-sm text-muted-foreground">The video has already started sending.</span>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <Tile icon={RiTerminalBoxLine} tone={stats.errors > 0 ? "danger" : "muted"} title="Console" value={`${stats.errors} ${stats.errors === 1 ? "error" : "errors"}`} />
            <Tile icon={RiGlobalLine} tone={stats.failed > 0 ? "warning" : "muted"} title="Network" value={`${stats.failed} failed`} />
            <Tile icon={RiCursorLine} tone="muted" title="Actions" value={`${stats.steps} ${stats.steps === 1 ? "step" : "steps"}`} />
            <Tile icon={RiWindowLine} tone="muted" title="Browser" value={`${draft.device.browser} · ${draft.device.os}`} />
          </div>
        </div>

        <aside className="flex min-h-0 min-w-0 flex-col border-t border-border lg:border-t-0 lg:border-l">
          {sent ? (
            <SentPanel
              sent={sent}
              details={props.sentDetails ?? null}
              visibility={props.sentDetails?.visibility ?? form.visibility}
              email={props.email}
              trackers={props.trackers ?? null}
              trackerNote={props.trackerNote ?? null}
              needsProject={props.needsProject ?? false}
              projects={props.projects}
              onPickProject={props.onPickProject}
              onVisibilityChange={props.onVisibilityChange}
              onSendToTracker={props.onSendToTracker}
              onAnother={props.onAnother}
              anotherLabel={isVideo ? "Record another" : "Take another"}
              onDone={() => props.onClose(null)}
            />
          ) : (
            <>
              {/* Three parts: the top and bottom keep their size, the middle (title and description) gives way and the
                  description scrolls inside it. The whole panel scrolls only when even that doesn't fit. */}
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 sm:p-7">
                <ReportFields
                  review={props}
                  form={form}
                  update={update}
                  notes={notes}
                  setNotes={setNotes}
                  titleField={titleField}
                  titleEdited={titleEdited}
                  setTitleEdited={setTitleEdited}
                  suggestion={suggestion}
                  problem={problem}
                  send={send}
                  ai={ai}
                  aiTemplate={aiTemplate}
                  setPickedTemplate={setPickedTemplate}
                  setAiRowElement={setAiRowElement}
                  writing={writing}
                  aiSeen={aiSeen}
                  writeWithAi={writeWithAi}
                  undo={undo}
                  setUndo={setUndo}
                  aiError={aiError}
                />
              </div>

              {sending && props.preparing != null ? (
                <PreparingBar fraction={props.preparing} />
              ) : (
                sending && props.uploadProgress && <UploadBar progress={props.uploadProgress} isVideo={isVideo} />
              )}
              <footer className="mx-5 flex items-center justify-between gap-2 border-t border-border py-5 sm:mx-7">
                <Button intent="plain" onPress={() => setConfirm("discard")} className="text-danger-subtle-foreground *:[svg]:text-danger-subtle-foreground">
                  <RiDeleteBinLine aria-hidden />
                  Discard
                </Button>
                <span className="flex gap-2">
                  <Button intent="outline" onPress={() => setConfirm("again")}>
                    {isVideo ? "Record again" : "Retake"}
                  </Button>
                  {props.signInUrl ? (
                    <Button onPress={() => window.open(props.signInUrl ?? "", "_blank", "noreferrer")}>Sign in to send</Button>
                  ) : (
                    <Button isDisabled={sending || props.sendBlocked} onPress={() => send()}>
                      {sending ? "Creating…" : "Create report"}
                    </Button>
                  )}
                </span>
              </footer>
            </>
          )}
        </aside>

        <Dialog
          role="alertdialog"
          isOpen={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          aria-label={asked === "close" ? "Keep this as a draft?" : asked === "again" ? "Take it again" : "Delete"}
          size="sm"
          closeButton={false}
        >
          <DialogHeader>
            <DialogTitle>
              {asked === "close"
                ? props.preparing != null
                  ? "The video is still being prepared. Leave anyway?"
                  : "Keep this as a draft?"
                : asked === "again"
                  ? isVideo
                    ? "Record again?"
                    : "Retake the screenshot?"
                  : isVideo
                    ? "Delete this recording?"
                    : "Delete this screenshot?"}
            </DialogTitle>
            <DialogDescription>
              {asked === "close"
                ? "You can finish it later from the BugBerry icon."
                : asked === "again"
                  ? isVideo
                    ? "This recording won't be saved. A new one starts on the same page."
                    : "This screenshot won't be saved. A new one is taken of the same page."
                  : "It won't be saved, and it can't be brought back."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button intent="outline" size="sm" onPress={() => setConfirm(null)}>
              Cancel
            </Button>
            {asked === "close" ? (
              <Button size="sm" onPress={() => props.onClose({ form, notes })}>
                Keep
              </Button>
            ) : asked === "again" ? (
              <Button
                size="sm"
                onPress={() => {
                  setConfirm(null)
                  props.onAgain()
                }}
              >
                {isVideo ? "Record again" : "Retake"}
              </Button>
            ) : (
              <Button
                intent="danger"
                size="sm"
                onPress={() => {
                  setConfirm(null)
                  props.onDiscard()
                }}
              >
                Delete
              </Button>
            )}
          </DialogFooter>
        </Dialog>
      </section>
    </div>
  )
}
