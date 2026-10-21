import {
  type IntegrationConfig,
  type IntegrationProvider,
  isTrackerProvider,
  NOTIFIER_PROVIDERS,
  type NotifierProvider,
  PROVIDER_LABELS,
  TRACKER_PROVIDERS,
  type TrackerProvider,
} from "@bugberry/shared"
import {
  RiArrowRightLine,
  RiArrowRightUpLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiEyeOffLine,
  RiKey2Line,
  RiRecordCircleLine,
  RiWebhookLine,
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
import { EMPTY_FIELDS, type IntegrationFields, validateIntegration, validateSecret } from "../lib/integrations"
import { GithubIcon } from "./LoginView"

export interface IntegrationSubmit {
  provider: IntegrationProvider
  config: IntegrationConfig
  secret: string
  autoSend: boolean
}

/** Where a GitHub admin makes the fine-grained token this form asks for. */
export const GITHUB_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new"
const GITLAB_COM = "https://gitlab.com"

/** What each provider calls its secret, where to make one, and what it needs. */
interface SecretSetup {
  label: string
  placeholder: string
  hint: string
  link?: (fields: IntegrationFields) => string
  optional?: boolean
}

const SECRET_SETUP: Record<IntegrationProvider, SecretSetup> = {
  github: {
    label: "Personal access token",
    placeholder: "github_pat_…",
    hint: "Fine-grained token with Issues: Read and write access to this repo.",
    link: () => GITHUB_TOKEN_URL,
  },
  activecollab: {
    label: "API token",
    placeholder: "Token",
    hint: "An ActiveCollab API token from an account that can create tasks in this project.",
  },
  gitlab: {
    label: "Personal access token",
    placeholder: "glpat-…",
    hint: "A token with the api scope, from an account that can create issues in this project.",
    link: (fields) => `${(fields.baseUrl.trim() || GITLAB_COM).replace(/\/+$/, "")}/-/user_settings/personal_access_tokens`,
  },
  linear: {
    label: "API key",
    placeholder: "lin_api_…",
    hint: "A personal API key from a member of this team.",
    link: () => "https://linear.app/settings/account/security",
  },
  jira: {
    label: "API token",
    placeholder: "Token",
    hint: "An API token of the account above, which can create issues in this project.",
    link: () => "https://id.atlassian.com/manage-profile/security/api-tokens",
  },
  slack: {
    label: "Incoming Webhook URL",
    placeholder: "https://hooks.slack.com/services/…",
    hint: "From a Slack app with Incoming Webhooks turned on, added to the channel.",
  },
  discord: {
    label: "Webhook URL",
    placeholder: "https://discord.com/api/webhooks/…",
    hint: "In the channel's settings: Integrations, then Webhooks.",
  },
  telegram: {
    label: "Bot token",
    placeholder: "123456:ABC…",
    hint: "From @BotFather. Add the bot to the group or channel first.",
  },
  webhook: {
    label: "Signing secret (optional)",
    placeholder: "Leave empty to send unsigned requests",
    hint: "With a secret, every request carries an x-bugberry-signature header to check.",
    optional: true,
  },
}

/**
 * A provider's own mark: GitHub's, ActiveCollab's app icon (public/assets/activecollab_icon.png, from activecollab.com),
 * a webhook glyph, and the others' logos in public/assets/integrations (from simple-icons, CC0).
 */
export function ProviderMark({ provider, className = "size-9" }: { provider: IntegrationProvider; className?: string }) {
  const frame = `grid shrink-0 place-content-center rounded-lg border border-border bg-background text-foreground ${className}`
  if (provider === "github") {
    return (
      <span aria-hidden className={frame}>
        <GithubIcon />
      </span>
    )
  }
  if (provider === "webhook") {
    return (
      <span aria-hidden className={frame}>
        <RiWebhookLine className="size-5" />
      </span>
    )
  }
  if (provider === "activecollab") {
    return <img src="/assets/activecollab_icon.png" alt="" className={`shrink-0 rounded-lg border border-border bg-background object-contain ${className}`} />
  }
  return (
    <img
      src={`/assets/integrations/${provider}.svg`}
      alt=""
      className={`shrink-0 rounded-lg border border-border bg-background object-contain p-1.5 ${className}`}
    />
  )
}

function initialFields(provider: IntegrationProvider, integration?: Integration): IntegrationFields {
  const config = (integration?.config ?? {}) as Record<string, unknown>
  const text = (key: keyof IntegrationFields) => (config[key] === undefined ? "" : String(config[key]))
  return {
    ...EMPTY_FIELDS,
    owner: text("owner"),
    repo: text("repo"),
    labels: Array.isArray(config.labels) ? config.labels.join(", ") : "",
    baseUrl: text("baseUrl") || (provider === "gitlab" ? GITLAB_COM : ""),
    projectId: text("projectId"),
    taskListId: text("taskListId"),
    projectPath: text("projectPath"),
    teamKey: text("teamKey"),
    siteUrl: text("siteUrl"),
    email: text("email"),
    projectKey: text("projectKey"),
    issueType: text("issueType") || "Bug",
    chatId: text("chatId"),
    url: text("url"),
  }
}

const labelList = (labels: string) =>
  labels
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean)

/** Labels as chips: Enter or a comma adds one, Backspace in the empty field takes the last back. */
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
  // ActiveCollab makes tasks without labels; the others open labelled issues.
  const tasks = provider === "activecollab"
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
              {tasks ? "Task" : "Open"}
            </span>
            {tasks ? "in the chosen task list" : "opened with this token"}
          </div>
          {!tasks && labels.length > 0 && (
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

const WEBHOOK_SAMPLE = `POST  x-bugberry-event: report.created
{
  "event": "report.created",
  "report": {
    "number": 42,
    "title": "Checkout hangs on Pay",
    "project": "Checkout Web",
    "pageUrl": "https://app.example.com/checkout",
    "url": "https://bugberry.example.com/app/r/…"
  }
}`

/** What a channel gets for one new report: the parts the server really sends (see notifiers/message.ts). */
export function MessagePreview({ provider }: { provider: NotifierProvider }) {
  const webhook = provider === "webhook"
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <RiEyeLine aria-hidden className="size-4" />
        {webhook ? "What your address receives" : `How a new report shows up in ${PROVIDER_LABELS[provider]}`}
      </p>
      {webhook ? (
        <pre aria-hidden className="overflow-x-auto rounded-2xl border border-border bg-background p-5 font-mono text-xs text-muted-foreground shadow-xs">
          {WEBHOOK_SAMPLE}
        </pre>
      ) : (
        <div aria-hidden className="flex gap-3 rounded-2xl border border-border bg-background p-5 shadow-xs">
          <ProviderMark provider={provider} className="size-9" />
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <p className="font-semibold text-foreground">BB-42 · Checkout hangs on “Pay”</p>
            <p className="text-muted-foreground">Checkout Web · reported by Dana Kim</p>
            <p className="text-muted-foreground">Chrome 141 · 1 console error · 1 failed request</p>
            <span className="mt-1 inline-flex items-center gap-1 font-medium text-primary">
              Open in BugBerry
              <RiArrowRightLine className="size-4" />
            </span>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {webhook
          ? "The webhook also gets the page address. Requests are signed when you set a secret."
          : "One message per new report. The page address stays out of the chat, since it can hold tokens."}
      </p>
    </div>
  )
}

function ProviderOption({ provider }: { provider: IntegrationProvider }) {
  return (
    <Radio
      value={provider}
      className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 outline-hidden transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 selected:border-primary selected:ring-2 selected:ring-primary/20"
    >
      {({ isSelected }) => (
        <>
          <ProviderMark provider={provider} className="size-8" />
          <span className="flex-1 font-medium text-foreground">{PROVIDER_LABELS[provider]}</span>
          {isSelected && <RiCheckboxCircleLine aria-hidden className="size-5 text-primary" />}
        </>
      )}
    </Radio>
  )
}

const PROVIDER_GROUPS = [
  { title: "Issue trackers", items: TRACKER_PROVIDERS },
  { title: "Notifications", items: NOTIFIER_PROVIDERS },
] as const

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
  initialProvider?: IntegrationProvider
  busy: boolean
  onSubmit(value: IntegrationSubmit): void
  onCancel(): void
}) {
  const tokenHint = useId()
  const [provider, setProvider] = useState<IntegrationProvider>(integration?.provider ?? initialProvider)
  const [fields, setFields] = useState(() => initialFields(integration?.provider ?? initialProvider, integration))
  const [secret, setSecret] = useState("")
  const [showSecret, setShowSecret] = useState(false)
  const [autoSend, setAutoSend] = useState(integration?.autoSend ?? false)
  const [error, setError] = useState<string | null>(null)
  const update = (changes: Partial<IntegrationFields>) => setFields((current) => ({ ...current, ...changes }))
  const text = (key: keyof IntegrationFields) => ({ value: fields[key], onChange: (value: string) => update({ [key]: value }) })
  const labels = labelList(fields.labels)
  const tracker = isTrackerProvider(provider)
  const setup = SECRET_SETUP[provider]
  const tokenLink = setup.link?.(fields)

  const choose = (next: IntegrationProvider) => {
    setProvider(next)
    // GitLab starts at gitlab.com; that address must not follow to ActiveCollab.
    setFields((current) => {
      if (next === "gitlab" && !current.baseUrl) return { ...current, baseUrl: GITLAB_COM }
      if (next !== "gitlab" && current.baseUrl === GITLAB_COM) return { ...current, baseUrl: "" }
      return current
    })
    setError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = validateIntegration(provider, fields)
    if (!result.ok) return setError(result.error)
    const token = secret.trim()
    if (!integration && !token && !setup.optional) return setError(`Enter the ${setup.label.toLowerCase()}`)
    const secretError = token ? validateSecret(provider, token) : null
    if (secretError) return setError(secretError)
    setError(null)
    onSubmit({ provider, config: result.config, secret: token, autoSend: tracker && autoSend })
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <form onSubmit={submit} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
        <div className="flex flex-col gap-1 border-b border-border px-6 py-5 sm:px-8">
          <h2 className="font-heading text-lg font-semibold text-foreground">{integration ? "Edit integration" : "New integration"}</h2>
          <p className="text-sm text-muted-foreground">
            {tracker
              ? `Send reports from ${projectName} to your tracker as new issues.`
              : `Tell a channel about every new report in ${projectName}.`}
          </p>
        </div>

        <div className="flex flex-col gap-6 px-6 py-6 sm:px-8">
          <RadioGroup
            aria-label="Provider"
            value={provider}
            isDisabled={Boolean(integration)}
            onChange={(value) => choose(value as IntegrationProvider)}
            className="flex flex-col gap-4"
          >
            <span className="text-sm font-medium text-foreground">Provider</span>
            {PROVIDER_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</span>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <ProviderOption key={item} provider={item} />
                  ))}
                </div>
              </div>
            ))}
          </RadioGroup>

          {provider === "github" && (
            <Field label="Repository">
              <div className="flex items-center gap-3">
                <TextField aria-label="Owner" {...text("owner")} className="flex-1">
                  <Input placeholder="owner" className="font-mono" />
                </TextField>
                <span aria-hidden className="text-lg text-muted-foreground">
                  /
                </span>
                <TextField aria-label="Repo" {...text("repo")} className="flex-1">
                  <Input placeholder="repo" className="font-mono" />
                </TextField>
              </div>
            </Field>
          )}
          {provider === "activecollab" && (
            <>
              <TextField {...text("baseUrl")}>
                <Label>ActiveCollab address</Label>
                <Input placeholder="https://ac.example.com" className="font-mono" />
              </TextField>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField inputMode="numeric" {...text("projectId")}>
                  <Label>Project ID</Label>
                  <Input />
                </TextField>
                <TextField inputMode="numeric" {...text("taskListId")}>
                  <Label>Task list ID</Label>
                  <Input />
                </TextField>
              </div>
            </>
          )}
          {provider === "gitlab" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField {...text("baseUrl")}>
                <Label>GitLab address</Label>
                <Input placeholder={GITLAB_COM} className="font-mono" />
              </TextField>
              <TextField {...text("projectPath")}>
                <Label>Project path</Label>
                <Input placeholder="group/project" className="font-mono" />
              </TextField>
            </div>
          )}
          {provider === "linear" && (
            <TextField {...text("teamKey")}>
              <Label>Team key</Label>
              <Input placeholder="ENG" className="font-mono" />
            </TextField>
          )}
          {provider === "jira" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField {...text("siteUrl")}>
                  <Label>Jira site</Label>
                  <Input placeholder="https://yourteam.atlassian.net" className="font-mono" />
                </TextField>
                <TextField type="email" {...text("email")}>
                  <Label>Atlassian account email</Label>
                  <Input placeholder="you@example.com" />
                </TextField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField {...text("projectKey")}>
                  <Label>Project key</Label>
                  <Input placeholder="BUG" className="font-mono" />
                </TextField>
                <TextField {...text("issueType")}>
                  <Label>Issue type</Label>
                  <Input placeholder="Bug" />
                </TextField>
              </div>
            </>
          )}
          {provider === "telegram" && (
            <TextField {...text("chatId")}>
              <Label>Chat ID</Label>
              <Input placeholder="-1001234567890 or @channel" className="font-mono" />
            </TextField>
          )}
          {provider === "webhook" && (
            <TextField type="url" {...text("url")}>
              <Label>Webhook URL</Label>
              <Input placeholder="https://example.com/bugberry" className="font-mono" />
            </TextField>
          )}
          {tracker && provider !== "activecollab" && (
            <Field label="Labels">
              <LabelChips labels={labels} onChange={(next) => update({ labels: next.join(", ") })} />
            </Field>
          )}

          <Field
            label={setup.label}
            aside={
              tokenLink && (
                <a href={tokenLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Create one on {PROVIDER_LABELS[provider]}
                  <RiArrowRightUpLine aria-hidden className="size-4" />
                </a>
              )
            }
          >
            <TextField
              aria-label={setup.label}
              aria-describedby={tokenHint}
              type={showSecret ? "text" : "password"}
              autoComplete="off"
              value={secret}
              onChange={setSecret}
            >
              <InputGroup>
                <Input placeholder={integration ? "Leave empty to keep the current one" : setup.placeholder} className="font-mono" />
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
              {setup.hint}
            </p>
          </Field>

          {tracker && (
            <div className="flex items-center justify-between gap-4 rounded-xl bg-muted px-5 py-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">Send every new report automatically</span>
                <span className="text-sm text-muted-foreground">If off, you pick which reports to send from the report page.</span>
              </div>
              <SwitchField aria-label="Send every new report automatically" isSelected={autoSend} onChange={setAutoSend}>
                <Switch />
              </SwitchField>
            </div>
          )}

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

      {isTrackerProvider(provider) ? <IssuePreview provider={provider} labels={labels} /> : <MessagePreview provider={provider} />}
    </div>
  )
}
