import {
  type IntegrationProvider,
  NOTIFIER_PROVIDERS,
  type NotifierProvider,
  PROVIDER_LABELS,
  TRACKER_PROVIDERS,
  type TrackerProvider,
} from "@bugberry/shared"
import {
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiRecordCircleLine,
  RiWebhookLine,
} from "@remixicon/react"
import type { ReactNode } from "react"
import { Radio } from "react-aria-components"
import type { ConnectionFields } from "../lib/integrations"
import { GithubIcon } from "../features/auth/LoginView"

/** Where a GitHub admin makes the fine-grained token this form asks for. */
export const GITHUB_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new"
export const GITLAB_COM = "https://gitlab.com"
/** Plane Cloud's API; a self-hosted Plane uses its own address instead. */
export const PLANE_CLOUD = "https://api.plane.so"
/** Where a provider's address starts when nobody typed one. */
export const DEFAULT_ADDRESS: Partial<Record<IntegrationProvider, string>> = { gitlab: GITLAB_COM, plane: PLANE_CLOUD }

/** What each provider calls its secret, where to make one, and what it needs. */
export interface SecretSetup {
  label: string
  placeholder: string
  hint: string
  link?: (fields: ConnectionFields) => string
  optional?: boolean
}

export const SECRET_SETUP: Record<IntegrationProvider, SecretSetup> = {
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
  plane: {
    label: "API key",
    placeholder: "plane_api_…",
    hint: "A personal access token from Plane: Profile Settings, then Personal Access Tokens. Its user must be a member of the projects.",
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
  // Full app icons (their own background and corners) are shown as they are, without padding.
  const appIcon = provider === "activecollab" ? "/assets/activecollab_icon.png" : provider === "plane" ? "/assets/integrations/plane.png" : null
  if (appIcon) {
    return <img src={appIcon} alt="" className={`shrink-0 rounded-lg border border-border bg-background object-contain ${className}`} />
  }
  return (
    <img
      src={`/assets/integrations/${provider}.svg`}
      alt=""
      className={`shrink-0 rounded-lg border border-border bg-background object-contain p-1.5 ${className}`}
    />
  )
}

export function Field({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
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

export function ProviderOption({ provider }: { provider: IntegrationProvider }) {
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

export const PROVIDER_GROUPS = [
  { title: "Issue trackers", items: TRACKER_PROVIDERS },
  { title: "Notifications", items: NOTIFIER_PROVIDERS },
] as const
