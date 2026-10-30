import { emailDomain, type Priority, type Visibility, visibilityChoices, visibilityOptions } from "@bugberry/shared"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Link } from "@bugberry/ui/link"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { RiArrowRightUpLine, RiCheckLine, RiFlagLine, RiFolderLine, RiGithubFill, RiHashtag, RiLink, RiRecordCircleLine, RiUserLine } from "@remixicon/react"
import { useEffect, useState } from "react"
import type { Project } from "../../lib/server/api"
import type { SentReport } from "../../lib/review/upload"
import { PRIORITY_LABELS } from "./parts"

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

function visibilityLabel(visibility: Visibility, email: string | null): string {
  if (visibility === "public") return "Anyone with the link"
  if (visibility === "internal") return email ? `Anyone at @${emailDomain(email)}` : "Anyone at your company"
  return "Workspace members"
}

/** Integration logos shipped with the extension (public/assets/integrations); GitHub's is the icon font's. */
const TRACKER_MARKS: Record<string, string> = {
  activecollab: "/assets/integrations/activecollab.png",
  gitlab: "/assets/integrations/gitlab.svg",
  jira: "/assets/integrations/jira.svg",
  linear: "/assets/integrations/linear.svg",
  plane: "/assets/integrations/plane.png",
}

/** The tracker's logo, so a repo name or "Project #261" says which integration it goes to. */
function TrackerMark({ provider }: { provider: string }) {
  if (provider === "github") return <RiGithubFill data-tracker-mark="github" aria-hidden className="size-5 shrink-0" />
  const src = TRACKER_MARKS[provider]
  return src ? <img data-tracker-mark={provider} src={src} alt="" className="size-5 shrink-0 rounded object-contain" /> : null
}

/** Tracker choices list the destination next to its logo, from the left. */
const trackerChoice = "h-auto min-h-10 justify-start py-2 text-left"

/** The right side once the report exists: what was created, its link and who sees it, and where else it can go. */
export function SentPanel(props: {
  sent: SentReport
  details: SentDetails | null
  visibility: Visibility
  email: string | null
  trackers: TrackerChoice[] | null
  trackerNote: string | null
  needsProject: boolean
  projects: Project[]
  onPickProject?(projectId: string): Promise<void> | void
  onVisibilityChange?(visibility: Visibility): void
  onSendToTracker?(integrationId: string): void
  onAnother?(): void
  anotherLabel: string
  onDone(): void
}) {
  const { sent, details } = props
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null)
  const [moving, setMoving] = useState(false)
  const pickProject = async (projectId: string) => {
    setMoving(true)
    try {
      await props.onPickProject?.(projectId)
    } finally {
      setMoving(false)
    }
  }
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
                  const done = typeof tracker.state === "object" && "url" in tracker.state ? tracker.state : null
                  if (done?.url) {
                    return (
                      <Link key={tracker.id} href={done.url} target="_blank" rel="noreferrer" className={buttonStyles({ intent: "outline", className: trackerChoice })}>
                        <TrackerMark provider={tracker.provider} />
                        <span className="min-w-0 flex-1 break-words">{tracker.label}</span>
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
                      className={trackerChoice}
                    >
                      <TrackerMark provider={tracker.provider} />
                      <span className="min-w-0 flex-1 break-words">{tracker.state === "sending" ? "Sending…" : tracker.label}</span>
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
          {props.needsProject &&
            props.onPickProject &&
            (props.projects.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Select placeholder="Pick a project" selectedKey={null} isDisabled={moving} onSelectionChange={(key) => key !== null && void pickProject(String(key))}>
                  <Label>Project</Label>
                  <SelectTrigger prefix={<RiFolderLine size={16} aria-hidden />} />
                  <SelectContent items={props.projects}>{(project) => <SelectItem id={project.id}>{project.name}</SelectItem>}</SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">{moving ? "Moving it to the project…" : "Pick a project to send it to that project's trackers."}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Create a project with a tracker to send reports there.</p>
            ))}
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
