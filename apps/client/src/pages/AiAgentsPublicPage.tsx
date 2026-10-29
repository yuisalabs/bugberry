import { useQuery } from "@tanstack/react-query"
import { AiAgentsView } from "./landing/AiAgentsView"
import { SiteNavigation } from "./landing/SiteNavigation"
import { usePageMeta } from "./landing/usePageMeta"
import { authQueries } from "../features/auth/queries"
import { queries } from "../lib/queries"

/** `/ai-agents` on BugBerry cloud. */
export function AiAgentsPublicPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(authQueries.clientConfig())
  usePageMeta("AI Agents", "Give Claude, Cursor or Copilot the recording, console, network and steps of every bug through BugBerry's MCP server.")
  return (
    <SiteNavigation>
      <AiAgentsView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} origin={window.location.origin} />
    </SiteNavigation>
  )
}
