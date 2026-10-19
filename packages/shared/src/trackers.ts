export const TRACKER_PROVIDERS = ["github", "activecollab"] as const
export type TrackerProvider = (typeof TRACKER_PROVIDERS)[number]

export const PROVIDER_LABELS: Record<TrackerProvider, string> = {
  github: "GitHub",
  activecollab: "ActiveCollab",
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

export type TrackerConfig = GithubConfig | ActiveCollabConfig

/** Short, human-readable name for an integration, shown next to the provider name. */
export function integrationLabel(provider: TrackerProvider, config: TrackerConfig): string {
  if (provider === "github" && "owner" in config) return `${config.owner}/${config.repo}`
  if (provider === "activecollab" && "projectId" in config) return `Project #${config.projectId}`
  return PROVIDER_LABELS[provider]
}
