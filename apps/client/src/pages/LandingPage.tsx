import { useQuery } from "@tanstack/react-query"
import { queries } from "../lib/queries"
import { HomeView } from "./landing/HomeView"
import { usePageMeta } from "./landing/usePageMeta"

/** `/`: the public home page. A signed-in visitor is offered the dashboard instead of sign-up. */
export function LandingPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(queries.clientConfig())
  usePageMeta(
    "BugBerry · Bug reporting for teams, and the agents that fix them",
    "One click captures the video, console, network and steps. BugBerry turns it into a ready-to-fix report for your tracker, your channel and your AI agents.",
  )
  return <HomeView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} />
}
