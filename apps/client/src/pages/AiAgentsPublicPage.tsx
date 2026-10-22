import { useQuery } from "@tanstack/react-query"
import { queries } from "../lib/queries"
import { AiAgentsView } from "./landing/AiAgentsView"
import { SiteNavigation } from "./landing/SiteNavigation"
import { usePageMeta } from "./landing/usePageMeta"

/** `/ai-agents` on BugBerry cloud. */
export function AiAgentsPublicPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(queries.clientConfig())
  usePageMeta("AI Agents", "Give Claude, Cursor or Copilot the recording, console, network and steps of every bug through BugBerry's MCP server.")
  return (
    <SiteNavigation>
      <AiAgentsView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} origin={window.location.origin} />
    </SiteNavigation>
  )
}
