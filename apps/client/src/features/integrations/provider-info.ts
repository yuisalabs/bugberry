import type { IntegrationProvider } from "@bugberry/shared"
import type { Connection } from "./queries"

export const projects = (count: number) => `${count} ${count === 1 ? "project" : "projects"}`

/** The delete confirmation names every project that loses the connection. */
export function deleteDescription(connection: Connection): string {
  const usedBy = connection.usedBy ?? []
  if (usedBy.length === 0) return "Not used in any project."
  return `Used in ${projects(usedBy.length)}: ${usedBy.map((use) => use.projectName).join(", ")}. They will stop sending to ${connection.name}.`
}

/** What each provider is and does, for its card under All integrations. */
export const PROVIDER_INFO: Record<IntegrationProvider, { category: string; text: string }> = {
  github: { category: "Issue tracker", text: "Open issues with the errors and a link to the replay." },
  gitlab: { category: "Issue tracker", text: "Turn reports into GitLab issues with a link to the full report." },
  jira: { category: "Issue tracker", text: "Create Jira tickets with the page, browser and errors." },
  linear: { category: "Issue tracker", text: "Send reports to a Linear team as issues." },
  activecollab: { category: "Project management", text: "Turn reports into tasks in your ActiveCollab projects." },
  plane: { category: "Project management", text: "File bugs as Plane work items, the replay one click away." },
  slack: { category: "Notifications", text: "Post every new report to a Slack channel." },
  discord: { category: "Notifications", text: "Ping your Discord server when a bug lands." },
  telegram: { category: "Notifications", text: "Ping a Telegram group when a bug lands." },
  webhook: { category: "Custom endpoint", text: "POST every new report to your own endpoint." },
}

/** "used in 1 project (Quinella AI)", "not used yet". */
export function usageText(connection: Connection): string {
  if (connection.usedIn === 0) return "not used yet"
  const names = (connection.usedBy ?? []).map((use) => use.projectName)
  return `used in ${projects(connection.usedIn)}${names.length > 0 ? ` (${names.join(", ")})` : ""}`
}

/** The providers with none of them connected first, each keeping its order; the ones already in use after. */
export function catalogueOrder(
  providers: readonly IntegrationProvider[],
  connected: Partial<Record<IntegrationProvider, number>>,
): IntegrationProvider[] {
  return [...providers.filter((provider) => !connected[provider]), ...providers.filter((provider) => connected[provider])]
}
