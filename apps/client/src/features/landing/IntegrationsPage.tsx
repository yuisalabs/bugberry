import { useQuery } from "@tanstack/react-query"
import { IntegrationsView } from "./IntegrationsView"
import { SiteNavigation } from "./SiteNavigation"
import { usePageMeta } from "./usePageMeta"
import { authQueries } from "../auth/queries"

/** `/integrations` on BugBerry cloud. */
export function IntegrationsPage() {
  const config = useQuery(authQueries.clientConfig())
  usePageMeta("Integrations", "Send BugBerry reports to GitHub, GitLab, Jira, Linear, ActiveCollab, Plane, Slack, Discord, Telegram or any webhook.")
  return (
    <SiteNavigation>
      <IntegrationsView installUrl={config.data?.extensionInstallUrl ?? null} />
    </SiteNavigation>
  )
}
