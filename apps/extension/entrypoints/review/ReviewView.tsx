import type { RecordingNote } from "@bugberry/capture"
import { clockLabel, defaultReportTitle, emailDomain, matchProject, PRIORITIES, type Priority, sizeLabel, type Visibility, visibilityChoices, visibilityOptions } from "@bugberry/shared"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Link } from "@bugberry/ui/link"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { TextField } from "@bugberry/ui/text-field"
import {
  type RemixiconComponentType,
  RiArrowRightUpLine,
  RiCameraLine,
  RiCheckLine,
  RiCloseLine,
  RiCursorLine,
  RiDeleteBinLine,
  RiFlagLine,
  RiFolderLine,
  RiGithubFill,
  RiGitlabFill,
  RiGlobalLine,
  RiHashtag,
  RiLink,
  RiRecordCircleLine,
  RiShieldCheckLine,
  RiTerminalBoxLine,
  RiUserLine,
  RiVideoOnLine,
  RiWindowLine,
} from "@remixicon/react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Button as AriaButton, Input as AriaInput, ProgressBar, TextArea as AriaTextArea } from "react-aria-components"
import type { Project, Workspace } from "../../lib/api"
import { formProblem } from "../../lib/report-form"
import { isTrimmed, reviewStats, suggestTitle, type TrimRange, trimPayload } from "../../lib/review-data"
import type { ReportDraft } from "../../lib/types"
import type { ReportForm, SentReport, UploadProgress } from "../../lib/upload"
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

/** What the server says about the report just created; null until it has answered (or when it couldn't). */
export interface SentDetails {
  /** Shown as BB-{number}. */
  number: number
  title: string
  status: string
  priority: Priority
  visibility: Visibility
  projectName: string | null
  assigneeName: string | null
}

/** A tracker of the report's project, and whether the report already went there. */
export interface TrackerChoice {
  id: string
  provider: string
  label: string
  state: "idle" | "sending" | { url: string | null } | { error: string }
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

/** "No project" in the project list; a list key can't be empty. */
const NO_PROJECT = "__none"
/** "Unassigned" in the assignee list. */
const NOBODY = "__nobody"

const PRIORITY_LABELS: Record<Priority, string> = { none: "No priority", low: "Low", medium: "Medium", high: "High", critical: "Critical" }

function visibilityLabel(visibility: Visibility, email: string | null): string {
  if (visibility === "public") return "Anyone with the link"
  if (visibility === "internal") return email ? `Anyone at @${emailDomain(email)}` : "Anyone at your company"
  return "Workspace members"
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
              onVisibilityChange={props.onVisibilityChange}
              onSendToTracker={props.onSendToTracker}
              onAnother={props.onAnother}
              anotherLabel={isVideo ? "Record another" : "Take another"}
              onDone={() => props.onClose(null)}
            />
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 sm:p-7">
                {!props.signInUrl && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-3">
                      <span id="save-to" className="shrink-0 text-sm text-muted-foreground">
                        Save to
                      </span>
                      <Select
                        aria-labelledby="save-to"
                        selectedKey={form.workspaceId ?? props.workspaceId ?? null}
                        isDisabled={props.workspaces.length < 2}
                        onSelectionChange={(key) => {
                          if (key === null) return
                          // Projects and people belong to a workspace, so a new workspace starts with neither chosen.
                          update({ workspaceId: String(key), projectId: "", assigneeId: "" })
                          props.onWorkspaceChange(String(key))
                        }}
                        className="w-auto min-w-0"
                      >
                        <SelectTrigger className="font-semibold" />
                        <SelectContent items={props.workspaces}>{(entry) => <SelectItem id={entry.id}>{entry.name}</SelectItem>}</SelectContent>
                      </Select>
                    </div>
                    {props.usage && <p className="text-xs text-muted-foreground">{props.usage}</p>}
                  </div>
                )}

                <TextField
                  aria-label="Title"
                  maxLength={200}
                  value={form.title}
                  onChange={(title) => {
                    setTitleEdited(true)
                    update({ title })
                  }}
                >
                  <AriaInput
                    placeholder={defaultReportTitle(draft.captureType, props.name ?? "you")}
                    className="w-full bg-transparent font-heading text-2xl font-bold text-foreground outline-hidden placeholder:text-muted-foreground/70"
                  />
                  {!titleEdited && suggestion && (
                    <Description className="text-xs text-primary">
                      {suggestion.from === "request" ? "Suggested from the failed request" : "Suggested from a console error"}
                    </Description>
                  )}
                </TextField>
                <TextField aria-label="What went wrong?" maxLength={5000} value={form.description} onChange={(description) => update({ description })} className="flex-1">
                  <AriaTextArea
                    rows={4}
                    placeholder="What went wrong? Describe what you expected to happen."
                    className="min-h-24 w-full flex-1 resize-none bg-transparent text-base text-foreground outline-hidden placeholder:text-muted-foreground/70"
                  />
                </TextField>

                <div className="grid grid-cols-2 gap-3">
                  {!props.signInUrl && (
                    <Select
                      selectedKey={form.projectId || NO_PROJECT}
                      onSelectionChange={(key) => key !== null && update({ projectId: key === NO_PROJECT ? "" : String(key) })}
                    >
                      <Label>Project</Label>
                      <SelectTrigger prefix={<RiFolderLine size={16} aria-hidden />} />
                      <SelectContent items={[{ id: NO_PROJECT, name: "No project" }, ...props.projects]}>
                        {(project) => <SelectItem id={project.id}>{project.name}</SelectItem>}
                      </SelectContent>
                    </Select>
                  )}
                  <Select selectedKey={form.priority} onSelectionChange={(key) => key !== null && update({ priority: key as Priority })}>
                    <Label>Priority</Label>
                    <SelectTrigger prefix={<RiFlagLine size={16} aria-hidden />} />
                    <SelectContent items={PRIORITIES.map((priority) => ({ id: priority, name: PRIORITY_LABELS[priority] }))}>
                      {(priority) => <SelectItem id={priority.id}>{priority.name}</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                {!props.signInUrl && (
                  <Select selectedKey={form.assigneeId || NOBODY} onSelectionChange={(key) => key !== null && update({ assigneeId: key === NOBODY ? "" : String(key) })}>
                    <Label>Assignee</Label>
                    <SelectTrigger prefix={<RiUserLine size={16} aria-hidden />} />
                    <SelectContent items={[{ id: NOBODY, name: "Unassigned" }, ...(props.members ?? [])]}>
                      {(member) => <SelectItem id={member.id}>{member.name || ("email" in member ? member.email : "")}</SelectItem>}
                    </SelectContent>
                  </Select>
                )}

                {notes.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm/6 font-medium text-foreground">Notes</span>
                    {notes.map((note, index) => (
                      <div key={note.n} className="flex items-center gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                          {note.n}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{clock(note.atMs)}</span>
                        <Input
                          aria-label={`Note ${note.n}`}
                          maxLength={500}
                          value={note.text}
                          onChange={(event) =>
                            setNotes((current) => current.map((entry, at) => (at === index ? { ...entry, text: event.target.value } : entry)))
                          }
                        />
                        <Button
                          intent="plain"
                          size="sq-xs"
                          aria-label={`Remove note ${note.n}`}
                          onPress={() => setNotes((current) => current.filter((_, at) => at !== index))}
                        >
                          <RiCloseLine aria-hidden />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <p className="flex items-center gap-2 rounded-xl bg-success-subtle px-3.5 py-2.5 text-sm text-success-subtle-foreground">
                  <RiShieldCheckLine size={16} aria-hidden className="shrink-0" />
                  Passwords and card numbers were masked in the logs
                </p>
                {/* Over someone else's page the city can't be asked for, so only the review in its own tab offers it. */}
                {!props.embedded && (
                  <div className="flex flex-col gap-1">
                    <CheckboxField isSelected={props.includeCity} onChange={props.onIncludeCityChange}>
                      <Checkbox>Include my city</Checkbox>
                    </CheckboxField>
                    {props.cityNote && <p className="text-xs text-muted-foreground">{props.cityNote}</p>}
                  </div>
                )}
                {draft.captureType === "video" && draft.stoppedAtLimitMs !== undefined && (
                  <p role="status" className="rounded-xl bg-warning-subtle px-3.5 py-2.5 text-sm text-warning-subtle-foreground">
                    {`The recording stopped by itself at ${clockLabel(draft.stoppedAtLimitMs)}, the longest allowed.`}
                  </p>
                )}
                {props.limitWarning && (
                  <p role="status" className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-subtle px-3.5 py-2.5 text-sm text-warning-subtle-foreground">
                    {props.limitWarning}
                    {props.onOpenDashboard && (
                      <AriaButton
                        className="rounded-sm font-semibold underline outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                        onPress={props.onOpenDashboard}
                      >
                        Open dashboard
                      </AriaButton>
                    )}
                  </p>
                )}
                {typeof props.status === "object" && "trimFailed" in props.status && (
                  <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-danger-subtle px-3.5 py-2.5 text-sm text-danger-subtle-foreground">
                    Couldn't trim the video: {props.status.trimFailed}
                    {!props.signInUrl && !props.fullVideoTooLong && (
                      <AriaButton
                        className="rounded-sm font-semibold underline outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                        onPress={() => send({ fullVideo: true })}
                      >
                        Send full video
                      </AriaButton>
                    )}
                  </p>
                )}
                {typeof props.status === "object" && "failed" in props.status && (
                  <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-danger-subtle px-3.5 py-2.5 text-sm text-danger-subtle-foreground">
                    {props.status.failed}
                    {!props.sendBlocked && !props.signInUrl && (
                      <AriaButton className="rounded-sm font-semibold underline outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onPress={() => send()}>
                        Try again
                      </AriaButton>
                    )}
                  </p>
                )}
                {typeof props.status === "object" && "signedOut" in props.status && (
                  <p role="alert" className="rounded-xl bg-danger-subtle px-3.5 py-2.5 text-sm text-danger-subtle-foreground">
                    Your session ended.{" "}
                    <Link href={props.status.signedOut} target="_blank" rel="noreferrer" className="font-semibold underline">
                      Sign in
                    </Link>
                    , then create the report again.
                  </p>
                )}
                {problem && (
                  <p role="alert" className="text-sm text-danger-subtle-foreground">
                    {problem}
                  </p>
                )}
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

const TRACKER_ICONS: Record<string, RemixiconComponentType> = { github: RiGithubFill, gitlab: RiGitlabFill }

/** The right side once the report exists: what was created, its link and who sees it, and where else it can go. */
function SentPanel(props: {
  sent: SentReport
  details: SentDetails | null
  visibility: Visibility
  email: string | null
  trackers: TrackerChoice[] | null
  trackerNote: string | null
  onVisibilityChange?(visibility: Visibility): void
  onSendToTracker?(integrationId: string): void
  onAnother?(): void
  anotherLabel: string
  onDone(): void
}) {
  const { sent, details } = props
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null)
  const copy = () =>
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(sent.shareUrl))
      .then(
        () => setCopied("copied"),
        () => setCopied("failed"),
      )
  // Copied as soon as the report exists: sharing it is what comes next. A refused clipboard just waits for "Copy".
  useEffect(() => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(sent.shareUrl))
      .then(
        () => setCopied("copied"),
        () => {},
      )
  }, [sent.shareUrl])
  const visibilities = props.email ? visibilityOptions(props.email) : visibilityChoices(false)
  const shown = visibilities.includes(props.visibility) ? visibilities : [...visibilities, props.visibility]

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5 sm:p-7">
        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <span className="mb-2 grid size-20 place-items-center rounded-full bg-success-subtle ring-8 ring-success-subtle/50">
            <RiCheckLine size={36} aria-hidden className="text-success-subtle-foreground" />
          </span>
          <h1 className="font-heading text-2xl font-bold">Report created</h1>
          <p className="text-muted-foreground">Your team can open it right away.</p>
        </div>

        {details && (
          <div className="flex flex-col gap-2 rounded-2xl bg-muted/60 p-4 ring-1 ring-border">
            <span className="flex items-center gap-2 text-sm">
              <span className="font-mono text-muted-foreground">BB-{details.number}</span>
              <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary capitalize">
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                {details.status.replaceAll("_", " ")}
              </span>
            </span>
            <span className="font-heading text-lg font-bold">{details.title}</span>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {details.projectName && (
                <span className="flex items-center gap-1">
                  <RiHashtag size={14} aria-hidden />
                  {details.projectName}
                </span>
              )}
              {details.priority !== "none" && (
                <span className="flex items-center gap-1">
                  <RiFlagLine size={14} aria-hidden className="text-danger-subtle-foreground" />
                  {PRIORITY_LABELS[details.priority]}
                </span>
              )}
              {details.assigneeName && (
                <span className="flex items-center gap-1">
                  <RiUserLine size={14} aria-hidden />
                  {details.assigneeName}
                </span>
              )}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span id="share-label" className="text-sm font-medium">
            Share link
          </span>
          <div className="flex items-center gap-2 rounded-xl px-3 py-1.5 ring-2 ring-primary/70">
            <RiLink size={16} aria-hidden className="shrink-0 text-muted-foreground" />
            <input
              aria-label="Share link"
              readOnly
              value={sent.shareUrl}
              onFocus={(event) => event.target.select()}
              className="min-w-0 flex-1 bg-transparent py-1 text-sm text-foreground outline-hidden"
            />
            {copied === "copied" ? (
              <span role="status" className="flex shrink-0 items-center gap-1 rounded-lg bg-success-subtle px-2.5 py-1 text-sm font-semibold text-success-subtle-foreground">
                <RiCheckLine size={14} aria-hidden />
                Copied
              </span>
            ) : (
              <Button size="xs" intent="outline" onPress={copy}>
                Copy
              </Button>
            )}
          </div>
          {copied === "failed" && <p className="text-xs text-muted-foreground">Your browser didn't allow copying. Select the link and copy it.</p>}
          <Select
            aria-label="Who can see it"
            selectedKey={props.visibility}
            isDisabled={!props.onVisibilityChange}
            onSelectionChange={(key) => key !== null && props.onVisibilityChange?.(key as Visibility)}
            className="w-auto self-start"
          >
            <SelectTrigger className="border-0 px-0 text-muted-foreground sm:px-0" />
            <SelectContent items={shown.map((visibility) => ({ id: visibility, name: visibilityLabel(visibility, props.email) }))}>
              {(visibility) => <SelectItem id={visibility.id}>{visibility.name}</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3">
          <Link href={sent.reportUrl} target="_blank" rel="noreferrer" className={buttonStyles({ size: "lg", className: "w-full justify-center" })}>
            Open report
            <RiArrowRightUpLine aria-hidden />
          </Link>
          {props.trackers && props.trackers.length > 0 && (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
                {props.trackers.map((tracker) => {
                  const Icon = TRACKER_ICONS[tracker.provider]
                  const done = typeof tracker.state === "object" && "url" in tracker.state ? tracker.state : null
                  if (done?.url) {
                    return (
                      <Link key={tracker.id} href={done.url} target="_blank" rel="noreferrer" className={buttonStyles({ intent: "outline", className: "justify-center" })}>
                        {Icon && <Icon aria-hidden />}
                        {tracker.label}
                        <RiCheckLine aria-hidden className="text-success-subtle-foreground" />
                      </Link>
                    )
                  }
                  return (
                    <Button
                      key={tracker.id}
                      intent="outline"
                      isDisabled={tracker.state === "sending" || done !== null}
                      onPress={() => props.onSendToTracker?.(tracker.id)}
                    >
                      {Icon && <Icon aria-hidden />}
                      {tracker.state === "sending" ? "Sending…" : tracker.label}
                    </Button>
                  )
                })}
              </div>
              {props.trackers.map(
                (tracker) =>
                  typeof tracker.state === "object" &&
                  "error" in tracker.state && (
                    <p key={tracker.id} role="alert" className="text-sm text-danger-subtle-foreground">
                      {tracker.label}: {tracker.state.error}
                    </p>
                  ),
              )}
              <p className="text-sm text-muted-foreground">Send it to a tracker without leaving this page.</p>
            </>
          )}
          {props.trackerNote && <p className="text-sm text-muted-foreground">{props.trackerNote}</p>}
        </div>
      </div>

      <footer className="mx-5 flex items-center justify-between gap-2 border-t border-border py-5 sm:mx-7">
        {props.onAnother ? (
          <Button intent="plain" onPress={props.onAnother} className="[--btn-foreground:var(--color-primary)] [--btn-icon:var(--color-primary)]">
            <RiRecordCircleLine aria-hidden />
            {props.anotherLabel}
          </Button>
        ) : (
          <span />
        )}
        <Button className="[--btn-bg:var(--color-foreground)] [--btn-foreground:var(--color-background)]" onPress={props.onDone}>
          Done
        </Button>
      </footer>
    </>
  )
}

function Tile({ icon: Icon, tone, title, value }: { icon: RemixiconComponentType; tone: "danger" | "warning" | "muted"; title: string; value: string }) {
  const color = tone === "danger" ? "text-danger-subtle-foreground" : tone === "warning" ? "text-warning-subtle-foreground" : "text-foreground"
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-border">
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone === "danger" ? "bg-danger-subtle" : tone === "warning" ? "bg-warning-subtle" : "bg-muted"}`}>
        <Icon size={18} aria-hidden className={tone === "muted" ? "text-muted-foreground" : color} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-muted-foreground">{title}</span>
        <span className={`truncate text-sm font-semibold ${color}`}>{value}</span>
      </span>
    </div>
  )
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** Above the footer while a trimmed video is encoded, before its upload starts. */
function PreparingBar({ fraction }: { fraction: number }) {
  const percent = Math.min(100, Math.max(0, Math.floor(fraction * 100)))
  return (
    <ProgressBar value={percent} aria-label="Preparing video" className="mx-5 flex flex-col gap-1.5 pb-3 sm:mx-7">
      <span className="text-xs text-muted-foreground tabular-nums">Preparing video… {percent}%</span>
      <span className="h-1 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </span>
    </ProgressBar>
  )
}

/** Above the footer while sending: how far the upload is, then that the server is making the report. */
function UploadBar({ progress, isVideo }: { progress: UploadProgress; isVideo: boolean }) {
  const done = progress.sent >= progress.total
  const percent = progress.total > 0 ? Math.min(100, Math.floor((progress.sent / progress.total) * 100)) : 100
  const label = done ? "Creating report…" : isVideo ? "Uploading video" : "Uploading screenshot"
  return (
    <ProgressBar
      value={percent}
      aria-label={label}
      valueLabel={`${sizeLabel(progress.sent)} of ${sizeLabel(progress.total)}, ${percent}%`}
      className="mx-5 flex flex-col gap-1.5 pb-3 sm:mx-7"
    >
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {sizeLabel(progress.sent)} of {sizeLabel(progress.total)} · {percent}%
        </span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </span>
    </ProgressBar>
  )
}
