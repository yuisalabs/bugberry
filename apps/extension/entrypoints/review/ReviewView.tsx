import type { RecordingNote } from "@bugberry/capture"
import { defaultReportTitle, emailDomain, matchProject, PRIORITIES, type Priority, type Visibility, visibilityChoices, visibilityOptions } from "@bugberry/shared"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Link } from "@bugberry/ui/link"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { TextField } from "@bugberry/ui/text-field"
import { Textarea } from "@bugberry/ui/textarea"
import { RiCloseLine, RiDeleteBinLine, RiShieldCheckLine } from "@remixicon/react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import type { Project, Workspace } from "../../lib/api"
import { formProblem } from "../../lib/report-form"
import { reviewStats, suggestTitle } from "../../lib/review-data"
import type { ReportDraft } from "../../lib/types"
import type { ReportForm } from "../../lib/upload"

export type ReviewStatus =
  | "ready"
  | "sending"
  | { failed: string }
  /** The dashboard session ended while sending. */
  | { signedOut: string }
  | { sent: { reportUrl: string; shareUrl: string } }

export interface ReviewViewProps {
  /** Over the recorded page (an iframe) rather than in a tab of its own. */
  embedded: boolean
  draft: ReportDraft
  /** The video player or the annotation canvas; the page builds it. */
  media: ReactNode
  workspaces: Workspace[]
  workspaceId: string | null
  projects: Project[]
  email: string | null
  /** The signed-in person's name: an untitled report is "Bugshoot by <name>" or "Bugcord by <name>". */
  name: string | null
  status: ReviewStatus
  includeCity: boolean
  cityNote: string | null
  onSend(form: ReportForm, notes: RecordingNote[]): void
  onDiscard(): void
  onAgain(): void
  /** `kept`: save these into the draft before closing; null after sending. */
  onClose(kept: { form: ReportForm; notes: RecordingNote[] } | null): void
  onWorkspaceChange(id: string): void
  onIncludeCityChange(on: boolean): void
  /** Every edit, so the draft keeps it even when the tab closes without "Keep". */
  onChange(form: ReportForm, notes: RecordingNote[]): void
}

/** "No project" in the project list; a list key can't be empty. */
const NO_PROJECT = "__none"

const PRIORITY_LABELS: Record<Priority, string> = { none: "No priority", low: "Low", medium: "Medium", high: "High", critical: "Critical" }

function visibilityLabel(visibility: Visibility, email: string | null): string {
  if (visibility === "public") return "Anyone with the link"
  if (visibility === "internal") return email ? `Anyone at @${emailDomain(email)}` : "Anyone at your company"
  return "Workspace members"
}

/** The "Review your report" modal (recording-result.html): media on the left, the report on the right, in Intent UI. */
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
  const [settings, setSettings] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const update = (changes: Partial<ReportForm>) => setForm((current) => ({ ...current, ...changes }))
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null)
  // Edits go up as they happen (not on the first render), so a closed tab or page doesn't lose them.
  const edited = useRef(false)
  const { onChange } = props
  useEffect(() => {
    if (edited.current) onChange(form, notes)
    edited.current = true
  }, [form, notes, onChange])

  const isVideo = draft.captureType === "video"
  const stats = reviewStats(events)
  const workspace = props.workspaces.find((entry) => entry.id === (form.workspaceId ?? props.workspaceId))
  const visibilities = props.email ? visibilityOptions(props.email) : visibilityChoices(false)
  const sending = props.status === "sending"
  const sent = typeof props.status === "object" && "sent" in props.status ? props.status.sent : null

  const send = () => {
    const values = { ...form, workspaceId: form.workspaceId ?? props.workspaceId ?? undefined }
    const found = formProblem(values)
    setProblem(found)
    if (!found) props.onSend(values, notes)
  }
  const close = () => (sent ? props.onClose(null) : setConfirm("close"))

  const shell = props.embedded
    ? "fixed inset-0 flex items-center justify-center bg-foreground/45 p-6"
    : "flex min-h-screen items-center justify-center bg-muted p-6"

  return (
    <div className={shell}>
      <section
        role="dialog"
        aria-labelledby="review-title"
        className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-overlay text-overlay-foreground shadow-2xl ring ring-muted-foreground/25"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h1 id="review-title" className="flex items-center gap-2 font-heading text-lg font-bold">
            <img src="/assets/bugberry_icon_small.webp" alt="" className="size-6 object-contain" />
            {sent ? "Report created" : "Review your report"}
          </h1>
          <Button intent="plain" size="sq-sm" aria-label="Close" onPress={close}>
            <RiCloseLine aria-hidden />
          </Button>
        </header>

        {sent ? (
          <div className="flex flex-col items-start gap-4 p-6">
            <p className="text-sm text-muted-foreground">Your report is ready to share with your team.</p>
            <div className="flex gap-3">
              <Button
                size="sm"
                onPress={() =>
                  void Promise.resolve()
                    .then(() => navigator.clipboard.writeText(sent.shareUrl))
                    .then(
                      () => setCopied("copied"),
                      () => setCopied("failed"),
                    )
                }
              >
                Copy link
              </Button>
              <Link href={sent.reportUrl} target="_blank" rel="noreferrer" className={buttonStyles({ intent: "outline", size: "sm" })}>
                Open report
              </Link>
            </div>
            {copied === "copied" && (
              <p role="status" className="text-sm text-success-subtle-foreground">
                Link copied
              </p>
            )}
            {copied === "failed" && (
              <TextField value={sent.shareUrl} isReadOnly aria-label="Share link" className="w-full">
                <Label>Copy this link:</Label>
                <Input onFocus={(event) => event.target.select()} />
              </TextField>
            )}
          </div>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="overflow-hidden rounded-xl bg-foreground">{props.media}</div>
                <div className="grid grid-cols-4 gap-2">
                  <Tile tone={stats.errors > 0 ? "danger" : "muted"} title="Console" value={`${stats.errors} ${stats.errors === 1 ? "error" : "errors"}`} />
                  <Tile tone={stats.failed > 0 ? "danger" : "muted"} title="Network" value={`${stats.failed} failed`} />
                  <Tile tone="muted" title="Actions" value={`${stats.steps} ${stats.steps === 1 ? "step" : "steps"}`} />
                  <Tile tone="muted" title="Browser" value={`${draft.device.browser} · ${draft.device.os}`} />
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <TextField
                  maxLength={200}
                  value={form.title}
                  onChange={(title) => {
                    setTitleEdited(true)
                    update({ title })
                  }}
                >
                  <FieldHead label="Title" optional />
                  <Input
                    placeholder={defaultReportTitle(draft.captureType, props.name ?? "you")}
                    className={!titleEdited && suggestion ? "border-primary" : undefined}
                  />
                  {!titleEdited && suggestion && (
                    <Description className="text-xs text-primary">
                      {suggestion.from === "request" ? "Suggested from the failed request" : "Suggested from a console error"}
                    </Description>
                  )}
                </TextField>
                <TextField maxLength={5000} value={form.description} onChange={(description) => update({ description })}>
                  <FieldHead label="What went wrong?" optional />
                  <Textarea rows={4} placeholder="Describe what you expected to happen" />
                </TextField>
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    selectedKey={form.projectId || NO_PROJECT}
                    onSelectionChange={(key) => key !== null && update({ projectId: key === NO_PROJECT ? "" : String(key) })}
                  >
                    <Label>Project</Label>
                    <SelectTrigger />
                    <SelectContent items={[{ id: NO_PROJECT, name: "No project" }, ...props.projects]}>
                      {(project) => <SelectItem id={project.id}>{project.name}</SelectItem>}
                    </SelectContent>
                  </Select>
                  <Select selectedKey={form.priority} onSelectionChange={(key) => key !== null && update({ priority: key as Priority })}>
                    <Label>Priority</Label>
                    <SelectTrigger />
                    <SelectContent items={PRIORITIES.map((priority) => ({ id: priority, name: PRIORITY_LABELS[priority] }))}>
                      {(priority) => <SelectItem id={priority.id}>{priority.name}</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <AriaButton
                    aria-expanded={settings}
                    onPress={() => setSettings(!settings)}
                    className="self-start rounded-md text-left text-xs text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/20"
                  >
                    {`${workspace?.name ?? "No workspace"} · ${visibilityLabel(form.visibility, props.email)}`}
                  </AriaButton>
                  {settings && (
                    <div className="flex flex-col gap-3 rounded-xl border border-border p-3 text-sm">
                      {props.workspaces.length > 1 && (
                        <Select
                          selectedKey={form.workspaceId ?? null}
                          onSelectionChange={(key) => {
                            if (key === null) return
                            // Projects belong to a workspace, so a new workspace starts with no project chosen.
                            update({ workspaceId: String(key), projectId: "" })
                            props.onWorkspaceChange(String(key))
                          }}
                        >
                          <Label>Workspace</Label>
                          <SelectTrigger />
                          <SelectContent items={props.workspaces}>{(entry) => <SelectItem id={entry.id}>{entry.name}</SelectItem>}</SelectContent>
                        </Select>
                      )}
                      <Select selectedKey={form.visibility} onSelectionChange={(key) => key !== null && update({ visibility: key as Visibility })}>
                        <Label>Who can see it</Label>
                        <SelectTrigger />
                        <SelectContent
                          items={(visibilities.includes(form.visibility) ? visibilities : [...visibilities, form.visibility]).map((visibility) => ({
                            id: visibility,
                            name: visibilityLabel(visibility, props.email),
                          }))}
                        >
                          {(visibility) => <SelectItem id={visibility.id}>{visibility.name}</SelectItem>}
                        </SelectContent>
                      </Select>
                      <CheckboxField isDisabled={props.embedded} isSelected={props.includeCity && !props.embedded} onChange={props.onIncludeCityChange}>
                        <Checkbox>Include my city</Checkbox>
                      </CheckboxField>
                      {props.embedded ? (
                        <p className="text-xs text-muted-foreground">Available when the review opens in its own tab</p>
                      ) : (
                        props.cityNote && <p className="text-xs text-muted-foreground">{props.cityNote}</p>
                      )}
                    </div>
                  )}
                </div>

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

                <p className="flex items-center gap-2 rounded-lg bg-success-subtle px-3 py-2 text-xs text-success-subtle-foreground">
                  <RiShieldCheckLine size={14} aria-hidden />
                  Passwords and card numbers were masked in the logs
                </p>
                {typeof props.status === "object" && "failed" in props.status && (
                  <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-subtle-foreground">
                    {props.status.failed}
                    <AriaButton className="rounded-sm font-semibold underline outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onPress={send}>
                      Try again
                    </AriaButton>
                  </p>
                )}
                {typeof props.status === "object" && "signedOut" in props.status && (
                  <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-subtle-foreground">
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
            </div>

            <footer className="flex items-center justify-between border-t border-border px-5 py-3">
              <Button
                intent="plain"
                size="sm"
                onPress={() => setConfirm("discard")}
                className="text-danger-subtle-foreground *:[svg]:text-danger-subtle-foreground"
              >
                <RiDeleteBinLine aria-hidden />
                Discard
              </Button>
              <span className="flex gap-2">
                <Button intent="outline" size="sm" onPress={() => setConfirm("again")}>
                  {isVideo ? "Record again" : "Retake"}
                </Button>
                <Button size="sm" isDisabled={sending} onPress={send}>
                  {sending ? "Creating…" : "Create report"}
                </Button>
              </span>
            </footer>
          </>
        )}

        <Dialog
          role="alertdialog"
          isOpen={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          aria-label={confirm === "close" ? "Keep this as a draft?" : "Delete"}
          size="sm"
          closeButton={false}
        >
          <DialogHeader>
            <DialogTitle>{confirm === "close" ? "Keep this as a draft?" : isVideo ? "Delete this recording?" : "Delete this screenshot?"}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button intent="outline" size="sm" onPress={() => setConfirm(null)}>
              Cancel
            </Button>
            {confirm === "close" ? (
              <Button size="sm" onPress={() => props.onClose({ form, notes })}>
                Keep
              </Button>
            ) : (
              <Button
                intent="danger"
                size="sm"
                onPress={() => {
                  const chosen = confirm
                  setConfirm(null)
                  if (chosen === "discard") props.onDiscard()
                  else props.onAgain()
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

/** A field's label, with "Optional" at the far end for fields that may stay empty. */
function FieldHead({ label, optional = false }: { label: string; optional?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      {optional && <span className="text-xs text-muted-foreground">Optional</span>}
    </div>
  )
}

function Tile({ tone, title, value }: { tone: "danger" | "muted"; title: string; value: string }) {
  return (
    <div className={`flex min-w-0 flex-col rounded-lg px-2.5 py-2 ${tone === "danger" ? "bg-danger-subtle" : "bg-muted"}`}>
      <span className="truncate text-[11px] text-muted-foreground">{title}</span>
      <span className={`truncate text-xs font-semibold ${tone === "danger" ? "text-danger-subtle-foreground" : "text-foreground"}`}>{value}</span>
    </div>
  )
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
