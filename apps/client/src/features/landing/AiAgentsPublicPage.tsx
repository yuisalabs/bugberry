import { useQuery } from "@tanstack/react-query"
import { AiAgentsView } from "./AiAgentsView"
import { SiteNavigation } from "./SiteNavigation"
import { usePageMeta } from "./usePageMeta"
import { authQueries } from "../auth/queries"

/** `/ai-agents` on BugBerry cloud. */
export function AiAgentsPublicPage() {
  const config = useQuery(authQueries.clientConfig())
  usePageMeta("AI Agents", "Give Claude, Cursor or Copilot the recording, console, network and steps of every bug through BugBerry's MCP server.")
  return (
    <SiteNavigation>
      <AiAgentsView installUrl={config.data?.extensionInstallUrl ?? null} origin={window.location.origin} />
    </SiteNavigation>
  )
}
