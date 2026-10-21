import { PROVIDER_LABELS, TRACKER_PROVIDERS, type TrackerConfig, type TrackerProvider } from "@bugberry/shared"
import {
  RiArrowRightLine,
  RiArrowRightUpLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiEyeOffLine,
  RiKey2Line,
  RiRecordCircleLine,
} from "@remixicon/react"
import { type FormEvent, type KeyboardEvent, type ReactNode, useId, useState } from "react"
import { Radio, RadioGroup } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input, InputGroup } from "@bugberry/ui/input"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { Tag, TagGroup, TagList } from "@bugberry/ui/tag-group"
import { TextField } from "@bugberry/ui/text-field"
import type { Integration } from "../lib/api"
import { type IntegrationFields, validateIntegration } from "../lib/integrations"
import { GithubIcon } from "./LoginView"

export interface IntegrationSubmit {
  provider: TrackerProvider
  config: TrackerConfig
  secret: string
  autoSend: boolean
}

/** Where a GitHub admin makes the fine-grained token this form asks for. */
export const GITHUB_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new"

/** A tracker's own mark: GitHub's, and ActiveCollab's app icon (public/assets/activecollab_icon.png, from activecollab.com). */
export function ProviderMark({ provider, className = "size-9" }: { provider: TrackerProvider; className?: string }) {
  return provider === "github" ? (
    <span aria-hidden className={`grid shrink-0 place-content-center rounded-lg border border-border bg-background text-foreground ${className}`}>
      <GithubIcon />
    </span>
  ) : (
    <img src="/assets/activecollab_icon.png" alt="" className={`shrink-0 rounded-lg border border-border bg-background object-contain ${className}`} />
  )
}

function initialFields(integration?: Integration): IntegrationFields {
  const config = integration?.config
  return {
    owner: config && "owner" in config ? config.owner : "",
    repo: config && "repo" in config ? config.repo : "",
    labels: config && "labels" in config ? config.labels.join(", ") : "",
    baseUrl: config && "baseUrl" in config ? config.baseUrl : "",
    projectId: config && "projectId" in config ? String(config.projectId) : "",
    taskListId: config && "taskListId" in config ? String(config.taskListId) : "",
  }
}

const labelList = (labels: string) =>
  labels
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean)

/** GitHub labels as chips: Enter or a comma adds one, Backspace in the empty field takes the last back. */
function LabelChips({ labels, onChange }: { labels: string[]; onChange(labels: string[]): void }) {
  const [text, setText] = useState("")
  const add = (raw: string) => {
    const next = [...labels]
    for (const label of labelList(raw)) if (!next.includes(label)) next.push(label)
    if (next.length !== labels.length) onChange(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      add(text)
      setText("")
    } else if (event.key === "Backspace" && !text && labels.length > 0) {
      onChange(labels.slice(0, -1))
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/20 *:data-[slot=control]:min-w-32 *:data-[slot=control]:flex-1">
      {labels.length > 0 && (
        <TagGroup aria-label="Labels" onRemove={(keys) => onChange(labels.filter((label) => !keys.has(label)))} className="contents">
          <TagList items={labels.map((label) => ({ label }))} className="contents">
            {({ label }) => (
              <Tag id={label} textValue={label}>
                {label}
              </Tag>
            )}
          </TagList>
        </TagGroup>
      )}
      <Input
        aria-label="Add label"
        placeholder={labels.length === 0 ? "bug, bugberry" : "Add label"}
        value={text}
        onChange={(event) => {
          const value = event.target.value
          if (value.includes(",")) {
            add(value)
            return setText("")
          }
          setText(value)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (text.trim()) add(text)
          setText("")
        }}
        className="border-0 bg-transparent px-0 py-0.5 focus:ring-0 sm:px-0 sm:py-0.5"
      />
    </div>
  )
}

function Field({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** What one report looks like once sent: the parts the server really writes (see buildIssueContent). */
export function IssuePreview({ provider, labels }: { provider: TrackerProvider; labels: readonly string[] }) {
  const github = provider === "github"
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <RiEyeLine aria-hidden className="size-4" />
        How a report shows up in {PROVIDER_LABELS[provider]}
      </p>
      <div aria-hidden className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
        <div className="flex flex-col gap-2 border-b border-border p-5">
          <p className="font-heading text-lg font-semibold text-foreground">Checkout hangs on “Pay”</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-0.5 text-xs font-medium text-success-foreground">
              <RiRecordCircleLine className="size-3.5" />
              {github ? "Open" : "Task"}
            </span>
            {github ? "opened with this token" : "in the chosen task list"}
          </div>
          {github && labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => (
                <span key={label} className="rounded-full bg-primary-subtle px-2 text-xs/5 font-medium text-primary">
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 p-5 text-sm">
          <p className="border-l-2 border-border pl-3 text-muted-foreground">The spinner never stops after I click Pay.</p>
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">Summary</span>
            <ul className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
              <li>Page: app.example.com/checkout</li>
              <li>Browser: Chrome 141 · macOS</li>
              <li>Console errors: 1 · Failed requests: 1</li>
            </ul>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">First errors</span>
            <code className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
              <RiErrorWarningLine className="size-3.5 shrink-0 text-danger" />
              TypeError: cart is undefined
            </code>
          </div>
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            Open the report in BugBerry
            <RiArrowRightLine className="size-4" />
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">The video, console and network stay in BugBerry; the issue links to them.</p>
    </div>
  )
}

export function IntegrationForm({
  integration,
  projectName = "this project",
  initialProvider = "github",
  busy,
  onSubmit,
  onCancel,
}: {
  integration?: Integration
  projectName?: string
  /** The provider picked from the empty page's cards. */
  initialProvider?: TrackerProvider
  busy: boolean
  onSubmit(value: IntegrationSubmit): void
  onCancel(): void
}) {
  const tokenHint = useId()
  const [provider, setProvider] = useState<TrackerProvider>(integration?.provider ?? initialProvider)
  const [fields, setFields] = useState(() => initialFields(integration))
  const [secret, setSecret] = useState("")
  const [showSecret, setShowSecret] = useState(false)
  const [autoSend, setAutoSend] = useState(integration?.autoSend ?? false)
  const [error, setError] = useState<string | null>(null)
  const update = (changes: Partial<IntegrationFields>) => setFields((current) => ({ ...current, ...changes }))
  const labels = labelList(fields.labels)
  const github = provider === "github"

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = validateIntegration(provider, fields)
    if (!result.ok) return setError(result.error)
    if (!integration && !secret.trim()) return setError("Enter a token")
    setError(null)
    onSubmit({ provider, config: result.config, secret: secret.trim(), autoSend })
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <form onSubmit={submit} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
        <div className="flex flex-col gap-1 border-b border-border px-6 py-5 sm:px-8">
          <h2 className="font-heading text-lg font-semibold text-foreground">{integration ? "Edit integration" : "New integration"}</h2>
          <p className="text-sm text-muted-foreground">Send reports from {projectName} to your tracker as new issues.</p>
        </div>

        <div className="flex flex-col gap-6 px-6 py-6 sm:px-8">
          <RadioGroup
            aria-label="Provider"
            value={provider}
            isDisabled={Boolean(integration)}
            onChange={(value) => setProvider(value as TrackerProvider)}
            className="flex flex-col gap-2"
          >
            <span className="text-sm font-medium text-foreground">Provider</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TRACKER_PROVIDERS.map((item) => (
                <Radio
                  key={item}
                  value={item}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 outline-hidden transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 selected:border-primary selected:ring-2 selected:ring-primary/20"
                >
                  {({ isSelected }) => (
                    <>
                      <ProviderMark provider={item} className="size-8" />
                      <span className="flex-1 font-medium text-foreground">{PROVIDER_LABELS[item]}</span>
                      {isSelected && <RiCheckboxCircleLine aria-hidden className="size-5 text-primary" />}
                    </>
                  )}
                </Radio>
              ))}
            </div>
          </RadioGroup>

          {github ? (
            <>
              <Field label="Repository">
                <div className="flex items-center gap-3">
                  <TextField aria-label="Owner" value={fields.owner} onChange={(owner) => update({ owner })} className="flex-1">
                    <Input placeholder="owner" className="font-mono" />
                  </TextField>
                  <span aria-hidden className="text-lg text-muted-foreground">
                    /
                  </span>
                  <TextField aria-label="Repo" value={fields.repo} onChange={(repo) => update({ repo })} className="flex-1">
                    <Input placeholder="repo" className="font-mono" />
                  </TextField>
                </div>
              </Field>
              <Field label="Labels">
                <LabelChips labels={labels} onChange={(next) => update({ labels: next.join(", ") })} />
              </Field>
            </>
          ) : (
            <>
              <TextField value={fields.baseUrl} onChange={(baseUrl) => update({ baseUrl })}>
                <Label>ActiveCollab address</Label>
                <Input placeholder="https://ac.example.com" className="font-mono" />
              </TextField>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField inputMode="numeric" value={fields.projectId} onChange={(projectId) => update({ projectId })}>
                  <Label>Project ID</Label>
                  <Input />
                </TextField>
                <TextField inputMode="numeric" value={fields.taskListId} onChange={(taskListId) => update({ taskListId })}>
                  <Label>Task list ID</Label>
                  <Input />
                </TextField>
              </div>
            </>
          )}

          <Field
            label={github ? "Personal access token" : "API token"}
            aside={
              github && (
                <a href={GITHUB_TOKEN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Create one on GitHub
                  <RiArrowRightUpLine aria-hidden className="size-4" />
                </a>
              )
            }
          >
            <TextField
              aria-label={github ? "Personal access token" : "API token"}
              aria-describedby={tokenHint}
              type={showSecret ? "text" : "password"}
              autoComplete="off"
              value={secret}
              onChange={setSecret}
            >
              <InputGroup>
                <Input
                  placeholder={integration ? "Leave empty to keep the current token" : github ? "github_pat_…" : "Token"}
                  className="font-mono"
                />
                <Button
                  intent="plain"
                  size="sq-xs"
                  aria-label={showSecret ? "Hide token" : "Show token"}
                  onPress={() => setShowSecret((shown) => !shown)}
                  className="me-1"
                >
                  {showSecret ? <RiEyeOffLine aria-hidden /> : <RiEyeLine aria-hidden />}
                </Button>
              </InputGroup>
            </TextField>
            <p id={tokenHint} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RiKey2Line aria-hidden className="size-3.5 shrink-0" />
              {github
                ? "Fine-grained token with Issues: Read and write access to this repo."
                : "An ActiveCollab API token from an account that can create tasks in this project."}
            </p>
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-muted px-5 py-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">Send every new report automatically</span>
              <span className="text-sm text-muted-foreground">If off, you pick which reports to send from the report page.</span>
            </div>
            <SwitchField aria-label="Send every new report automatically" isSelected={autoSend} onChange={setAutoSend}>
              <Switch />
            </SwitchField>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger-subtle-foreground">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-muted/50 px-6 py-4 sm:px-8">
          <Button intent="outline" onPress={onCancel}>
            Cancel
          </Button>
          <Button type="submit" isDisabled={busy}>
            Save integration
          </Button>
        </div>
      </form>

      <IssuePreview provider={provider} labels={labels} />
    </div>
  )
}
