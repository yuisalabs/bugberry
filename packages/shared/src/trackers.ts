/** Integrations that turn a report into an issue. */
export const TRACKER_PROVIDERS = ["github", "activecollab", "gitlab", "linear", "jira"] as const
export type TrackerProvider = (typeof TRACKER_PROVIDERS)[number]

/** Integrations that post a message to a chat channel (or a URL) when a new report comes in. */
export const NOTIFIER_PROVIDERS = ["slack", "discord", "telegram", "webhook"] as const
export type NotifierProvider = (typeof NOTIFIER_PROVIDERS)[number]

export const INTEGRATION_PROVIDERS = [...TRACKER_PROVIDERS, ...NOTIFIER_PROVIDERS] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]

export function isTrackerProvider(provider: IntegrationProvider): provider is TrackerProvider {
  return (TRACKER_PROVIDERS as readonly string[]).includes(provider)
}

export function integrationKind(provider: IntegrationProvider): "tracker" | "notifier" {
  return isTrackerProvider(provider) ? "tracker" : "notifier"
}

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  github: "GitHub",
  activecollab: "ActiveCollab",
  gitlab: "GitLab",
  linear: "Linear",
  jira: "Jira",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
  webhook: "Webhook",
}

export interface GithubConfig {
  owner: string
  repo: string
  labels: string[]
}

export interface ActiveCollabConfig {
  /** Instance URL, e.g. https://ac.kantor.com (self-hosted) — no trailing slash. */
  baseUrl: string
  projectId: number
  taskListId: number
}

export interface GitlabConfig {
  /** https://gitlab.com or a self-hosted GitLab, no trailing slash. */
  baseUrl: string
  /** "group/project", or deeper with subgroups. */
  projectPath: string
  labels: string[]
}

export interface LinearConfig {
  /** The team's key, such as ENG. */
  teamKey: string
  labels: string[]
}

export interface JiraConfig {
  /** https://<name>.atlassian.net (Jira Cloud). */
  siteUrl: string
  /** The Atlassian account the API token belongs to. */
  email: string
  projectKey: string
  /** Such as Bug or Task. */
  issueType: string
  labels: string[]
}

/** Slack and Discord keep everything in their (secret) webhook URL. */
export type SlackConfig = Record<string, never>
export type DiscordConfig = Record<string, never>

export interface TelegramConfig {
  /** A group's numeric id (often negative) or a channel's @name. */
  chatId: string
}

export interface WebhookConfig {
  url: string
}

export type TrackerConfig = GithubConfig | ActiveCollabConfig | GitlabConfig | LinearConfig | JiraConfig
export type NotifierConfig = SlackConfig | DiscordConfig | TelegramConfig | WebhookConfig
export type IntegrationConfig = TrackerConfig | NotifierConfig

/** Short, human-readable name for an integration, shown next to the provider name. */
export function integrationLabel(provider: IntegrationProvider, config: IntegrationConfig): string {
  if (provider === "github" && "owner" in config) return `${config.owner}/${config.repo}`
  if (provider === "activecollab" && "projectId" in config) return `Project #${config.projectId}`
  if (provider === "gitlab" && "projectPath" in config) return config.projectPath
  if (provider === "linear" && "teamKey" in config) return `Team ${config.teamKey}`
  if (provider === "jira" && "projectKey" in config) return config.projectKey
  if (provider === "telegram" && "chatId" in config) return `Chat ${config.chatId}`
  if (provider === "webhook" && "url" in config) {
    try {
      return new URL(config.url).host
    } catch {
      return "Webhook"
    }
  }
  if (provider === "slack") return "Slack channel"
  if (provider === "discord") return "Discord channel"
  return PROVIDER_LABELS[provider]
}

/** How a tracker refers to its issue: "#42" for numbered ones, the key itself for Linear and Jira ("ENG-142"). */
export function issueReference(provider: IntegrationProvider | null, externalId: string): string {
  return provider === "linear" || provider === "jira" ? externalId : `#${externalId}`
}
