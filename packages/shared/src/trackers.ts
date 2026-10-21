/** Integrations that turn a report into an issue. */
export const TRACKER_PROVIDERS = ["github", "activecollab", "gitlab", "linear", "jira", "plane"] as const
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
  plane: "Plane",
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

export interface PlaneConfig {
  /** https://api.plane.so (Plane Cloud) or a self-hosted Plane, no trailing slash. */
  baseUrl: string
  /** The workspace part of Plane's URLs: "my-team" in app.plane.so/my-team/projects. */
  workspaceSlug: string
  /** The Plane project's id (a UUID). */
  projectId: string
  /** "Website (WEB)", kept for showing; work items are numbered with the project's identifier. */
  projectName: string
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

export type TrackerConfig = GithubConfig | ActiveCollabConfig | GitlabConfig | LinearConfig | JiraConfig | PlaneConfig
export type NotifierConfig = SlackConfig | DiscordConfig | TelegramConfig | WebhookConfig
export type IntegrationConfig = TrackerConfig | NotifierConfig

/** What a workspace connection holds besides its secret: the account's address or login, nothing else. */
export type ConnectionSettings =
  | Record<string, never>
  | { baseUrl: string }
  | { siteUrl: string; email: string }
  | { baseUrl: string; workspaceSlug: string }
  | { url: string }

/** Where a project's use of a connection sends: the part a project picks. Notification channels have none but Telegram's chat. */
export type UseTarget =
  | { owner: string; repo: string; labels: string[] }
  | { projectPath: string; labels: string[] }
  | { teamKey: string; labels: string[] }
  | { projectKey: string; issueType: string; labels: string[] }
  | { projectId: number; taskListId: number }
  | { projectId: string; projectName: string; labels: string[] }
  | { chatId: string }
  | Record<string, never>

/** The config keys that belong to a connection; everything else in a merged config is the use's target. */
export const CONNECTION_SETTING_KEYS = ["baseUrl", "siteUrl", "email", "url", "workspaceSlug"] as const

/** Whether a project picks something when it uses this provider: every tracker, and Telegram's chat. */
export function hasTarget(provider: IntegrationProvider): boolean {
  return isTrackerProvider(provider) || provider === "telegram"
}

/** Two uses of one connection in a project with the same key point at the same place. Labels never count. */
export function targetKey(provider: IntegrationProvider, target: UseTarget): string {
  if (provider === "github" && "owner" in target) return `${target.owner}/${target.repo}`.toLowerCase()
  if (provider === "gitlab" && "projectPath" in target) return target.projectPath.toLowerCase()
  if (provider === "linear" && "teamKey" in target) return target.teamKey.toUpperCase()
  if (provider === "jira" && "projectKey" in target) return `${target.projectKey}/${target.issueType}`.toLowerCase()
  if (provider === "activecollab" && "taskListId" in target) return `${target.projectId}/${target.taskListId}`
  if (provider === "plane" && "projectName" in target) return target.projectId.toLowerCase()
  if (provider === "telegram" && "chatId" in target) return target.chatId
  return ""
}

/** A use's target as people read it ("kantor/web", "Team ENG"); null when there is none. */
export function targetLabel(provider: IntegrationProvider, target: UseTarget): string | null {
  if (provider === "github" && "owner" in target) return `${target.owner}/${target.repo}`
  if (provider === "gitlab" && "projectPath" in target) return target.projectPath
  if (provider === "linear" && "teamKey" in target) return `Team ${target.teamKey}`
  if (provider === "jira" && "projectKey" in target) return `${target.projectKey} · ${target.issueType}`
  if (provider === "plane" && "projectName" in target) return target.projectName
  if (provider === "activecollab" && "projectId" in target) return `Project #${target.projectId}`
  if (provider === "telegram" && "chatId" in target) return `Chat ${target.chatId}`
  return null
}

/** Short, human-readable name for an integration, shown next to the provider name. */
export function integrationLabel(provider: IntegrationProvider, config: IntegrationConfig): string {
  if (provider === "github" && "owner" in config) return `${config.owner}/${config.repo}`
  if (provider === "activecollab" && "projectId" in config) return `Project #${config.projectId}`
  if (provider === "gitlab" && "projectPath" in config) return config.projectPath
  if (provider === "linear" && "teamKey" in config) return `Team ${config.teamKey}`
  if (provider === "jira" && "projectKey" in config) return config.projectKey
  if (provider === "plane" && "projectName" in config) return config.projectName
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

/** How a tracker refers to its issue: "#42" for numbered ones, the key itself for Linear, Jira and Plane ("ENG-142"). */
export function issueReference(provider: IntegrationProvider | null, externalId: string): string {
  return provider === "linear" || provider === "jira" || provider === "plane" ? externalId : `#${externalId}`
}
