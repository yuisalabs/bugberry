import { useQuery } from "@tanstack/react-query"
import { queries } from "../lib/queries"
import { IntegrationsView } from "./landing/IntegrationsView"
import { SiteNavigation } from "./landing/SiteNavigation"
import { usePageMeta } from "./landing/usePageMeta"

/** `/integrations` on BugBerry cloud. */
export function IntegrationsPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(queries.clientConfig())
  usePageMeta("Integrations", "Send BugBerry reports to GitHub, GitLab, Jira, Linear, ActiveCollab, Plane, Slack, Discord, Telegram or any webhook.")
  return (
    <SiteNavigation>
      <IntegrationsView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} />
    </SiteNavigation>
  )
}
