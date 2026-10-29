import type { IntegrationProvider } from "@bugberry/shared"
import { IntegrationGroup } from "./IntegrationsLayout"
import { PROVIDER_GROUPS } from "./IntegrationForm"
import type { TestResult } from "./integrations-ui"
import type { Connection } from "./queries"
import { ConnectionRow } from "./ConnectionRow"

/** What each group says while nothing in it is connected. */
const EMPTY_GROUPS: Record<string, { title: string; text: string; action: string; marks: readonly IntegrationProvider[] }> = {
  "Issue trackers": {
    title: "No issue trackers yet",
    text: "Turn reports into issues in GitHub, GitLab, Jira or Linear, with the logs attached.",
    action: "Connect a tracker",
    marks: ["github", "gitlab", "jira"],
  },
  Notifications: {
    title: "No chat channels yet",
    text: "Post new reports to Slack, Discord or Telegram so the right people see them first.",
    action: "Connect a channel",
    marks: ["slack", "discord", "telegram"],
  },
}

/**
 * The workspace's connections, trackers then chat channels, each group a grid of cards ending with the card that
 * connects one more (its first provider's form).
 */
export function ConnectionGroups({
  connections,
  testResult,
  testing,
  removing,
  onTest,
  onEdit,
  onDelete,
  onAdd,
}: {
  connections: readonly Connection[]
  /** The last test, for the connection it was run on. */
  testResult: (TestResult & { id?: string }) | null
  testing: boolean
  removing: boolean
  onTest(id: string): void
  onEdit(id: string): void
  onDelete(connection: Connection): void
  onAdd(provider: IntegrationProvider): void
}) {
  return PROVIDER_GROUPS.map((group) => {
    const rows = connections.filter((item) => (group.items as readonly string[]).includes(item.provider))
    const empty = EMPTY_GROUPS[group.title]
    if (!empty) return null
    return (
      <IntegrationGroup key={group.title} title={group.title} count={rows.length} empty={empty} onAdd={() => onAdd(group.items[0])}>
        {rows.map((item) => (
          <ConnectionRow
            key={item.id}
            connection={item}
            testResult={testResult?.id === item.id ? testResult : null}
            testing={testing}
            removing={removing}
            onTest={() => onTest(item.id)}
            onEdit={() => onEdit(item.id)}
            onDelete={() => onDelete(item)}
          />
        ))}
      </IntegrationGroup>
    )
  })
}
