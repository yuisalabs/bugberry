import { useQuery } from "@tanstack/react-query"
import { IntegrationsView } from "./IntegrationsView"
import { SiteNavigation } from "./SiteNavigation"
import { usePageMeta } from "./usePageMeta"
import { authQueries } from "../auth/queries"
import { accountQueries } from "../account/queries"

/** `/integrations` on BugBerry cloud. */
export function IntegrationsPage() {
  const me = useQuery({ ...accountQueries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(authQueries.clientConfig())
  usePageMeta("Integrations", "Send BugBerry reports to GitHub, GitLab, Jira, Linear, ActiveCollab, Plane, Slack, Discord, Telegram or any webhook.")
  return (
    <SiteNavigation>
      <IntegrationsView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} />
    </SiteNavigation>
  )
}
