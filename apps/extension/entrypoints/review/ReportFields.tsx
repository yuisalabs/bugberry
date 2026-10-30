import type { RecordingNote } from "@bugberry/capture"
import { clockLabel, defaultReportTitle, PRIORITIES, type Priority } from "@bugberry/shared"
import { Button } from "@bugberry/ui/button"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Link } from "@bugberry/ui/link"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { TextField } from "@bugberry/ui/text-field"
import { RiCloseLine, RiFileTextLine, RiFlagLine, RiFolderLine, RiShieldCheckLine, RiSparkling2Line, RiUserLine } from "@remixicon/react"
import type { Dispatch, SetStateAction } from "react"
import { Button as AriaButton, TextArea as AriaTextArea } from "react-aria-components"
import type { ReportForm } from "../../lib/review/upload"
import { clock, PRIORITY_LABELS } from "./parts"
import type { ReviewViewProps } from "./ReviewView"

/** "No project" in the project list; a list key can't be empty. */
const NO_PROJECT = "__none"
/** "Unassigned" in the assignee list. */
const NOBODY = "__nobody"

type Draft = { title: string; description: string }

/** The report's fields while it is reviewed; ReviewView keeps their state. */
export interface ReportFieldsProps {
  review: ReviewViewProps
  form: ReportForm
  update(changes: Partial<ReportForm>): void
  notes: RecordingNote[]
  setNotes: Dispatch<SetStateAction<RecordingNote[]>>
  titleField(element: HTMLTextAreaElement | null): void
  titleEdited: boolean
  setTitleEdited(edited: boolean): void
  suggestion: { title: string; from: "request" | "console" } | null
  problem: string | null
  send(options?: { fullVideo?: boolean }): void
  ai: NonNullable<ReviewViewProps["ai"]> | null
  aiTemplate: string | null
  setPickedTemplate(id: string): void
  setAiRowElement(element: HTMLDivElement | null): void
  writing: boolean
  aiSeen: boolean
  writeWithAi(): Promise<void>
  undo: Draft | null
  setUndo(undo: Draft | null): void
  aiError: string | null
}

export function ReportFields(fields: ReportFieldsProps) {
  const { review: props, form, update, notes, setNotes, titleField, titleEdited, setTitleEdited, suggestion, problem, send } = fields
  const { ai, aiTemplate, setPickedTemplate, setAiRowElement, writing, aiSeen, writeWithAi, undo, setUndo, aiError } = fields
  const { draft } = props
  const isVideo = draft.captureType === "video"
  return (
    <>
      <div data-review-part="top" className="flex shrink-0 flex-col gap-5">
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

        {isVideo && ai && !props.signInUrl && (
          <div ref={setAiRowElement} className="flex flex-col gap-2">
            {ai.path ? (
              ai.templates.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label="Template"
                    selectedKey={aiTemplate}
                    onSelectionChange={(key) => key !== null && setPickedTemplate(String(key))}
                    className="w-auto min-w-0 flex-1"
                  >
                    <SelectTrigger prefix={<RiFileTextLine size={16} aria-hidden />} />
                    <SelectContent items={ai.templates}>{(template) => <SelectItem id={template.id}>{template.name}</SelectItem>}</SelectContent>
                  </Select>
                  <Button intent="outline" isPending={writing} isDisabled={!aiSeen} onPress={() => void writeWithAi()}>
                    <RiSparkling2Line aria-hidden />
                    Write with AI
                  </Button>
                  {undo && (
                    <AriaButton
                      className="rounded-sm text-sm font-semibold text-primary underline outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onPress={() => {
                        update(undo)
                        setUndo(null)
                      }}
                    >
                      Undo
                    </AriaButton>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Add a template in Settings → AI to write with AI</p>
              )
            ) : ai.error ? (
              <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-subtle-foreground">
                {ai.error}
                {props.onAiRetry && (
                  <AriaButton
                    className="rounded-sm font-semibold underline outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    onPress={props.onAiRetry}
                  >
                    Try again
                  </AriaButton>
                )}
              </p>
            ) : ai.isAdmin ? (
              <Link href={ai.settingsUrl} target="_blank" rel="noreferrer" className="self-start text-sm font-semibold text-primary">
                Set up AI
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">Ask your admin to set up AI in Settings → AI</p>
            )}
            {aiError && (
              <p role="alert" className="text-sm text-danger-subtle-foreground">
                {aiError}
              </p>
            )}
          </div>
        )}
      </div>

      <div data-review-part="middle" className="flex min-h-40 flex-1 flex-col gap-5">
        <TextField
          aria-label="Title"
          isReadOnly={writing}
          maxLength={200}
          value={form.title}
          onChange={(title) => {
            setTitleEdited(true)
            setUndo(null)
            // A title is one paragraph: pasted line breaks become spaces.
            update({ title: title.replace(/\s*\n\s*/g, " ") })
          }}
        >
          <AriaTextArea
            ref={titleField}
            rows={1}
            placeholder={defaultReportTitle(draft.captureType, props.name ?? "you")}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault()
            }}
            className="w-full resize-none overflow-hidden bg-transparent font-heading text-lg/tight font-bold text-foreground outline-hidden placeholder:text-muted-foreground/70"
          />
          {!titleEdited && suggestion && (
            <Description className="text-xs text-primary">
              {suggestion.from === "request" ? "Suggested from the failed request" : "Suggested from a console error"}
            </Description>
          )}
        </TextField>
        <TextField
          aria-label="What went wrong?"
          isReadOnly={writing}
          maxLength={5000}
          value={form.description}
          onChange={(description) => {
            setUndo(null)
            update({ description })
          }}
          // Fills the space down to Project, Priority and Assignee, which stay in view; a long description
          // scrolls inside it.
          className="flex min-h-32 flex-1 flex-col"
        >
          <AriaTextArea
            rows={4}
            placeholder="What went wrong? Describe what you expected to happen."
            className="min-h-24 w-full flex-1 resize-none overflow-y-auto bg-transparent text-base text-foreground outline-hidden placeholder:text-muted-foreground/70"
          />
        </TextField>
      </div>

      <div data-review-part="bottom" className="flex shrink-0 flex-col gap-5">
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
          {/* Many notes scroll here, so the bottom part doesn't push the description away. */}
          <div className="-m-1 flex max-h-40 flex-col gap-2 overflow-y-auto p-1">
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
    </>
  )
}
