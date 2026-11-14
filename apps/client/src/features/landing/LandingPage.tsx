import { useQuery } from "@tanstack/react-query"
import { HomeView } from "./HomeView"
import { SiteNavigation } from "./SiteNavigation"
import { usePageMeta } from "./usePageMeta"
import { authQueries } from "../auth/queries"

/** `/`: the public home page. */
export function LandingPage() {
  const config = useQuery(authQueries.clientConfig())
  usePageMeta(
    "BugBerry · Bug reporting for teams, and the agents that fix them",
    "One click captures the video, console, network and steps. BugBerry turns it into a ready-to-fix report for your tracker, your channel and your AI agents.",
  )
  return (
    <SiteNavigation>
      <HomeView installUrl={config.data?.extensionInstallUrl ?? null} />
    </SiteNavigation>
  )
}
