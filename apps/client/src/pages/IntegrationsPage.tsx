import { useQuery } from "@tanstack/react-query"
import { IntegrationsView } from "./landing/IntegrationsView"
import { SiteNavigation } from "./landing/SiteNavigation"
import { usePageMeta } from "./landing/usePageMeta"
import { authQueries } from "../features/auth/queries"
import { queries } from "../lib/queries"

/** `/integrations` on BugBerry cloud. */
export function IntegrationsPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(authQueries.clientConfig())
  usePageMeta("Integrations", "Send BugBerry reports to GitHub, GitLab, Jira, Linear, ActiveCollab, Plane, Slack, Discord, Telegram or any webhook.")
  return (
    <SiteNavigation>
      <IntegrationsView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} />
    </SiteNavigation>
  )
}
