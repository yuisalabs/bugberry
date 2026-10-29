import { useQuery } from "@tanstack/react-query"
import { api } from "../lib/client"
import { DemoView } from "./landing/DemoView"
import { SiteNavigation } from "./landing/SiteNavigation"
import { usePageMeta } from "./landing/usePageMeta"
import { authQueries } from "../features/auth/queries"
import { accountQueries } from "../features/account/queries"

/** `/demo` on BugBerry cloud. */
export function DemoPage() {
  const me = useQuery({ ...accountQueries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(authQueries.clientConfig())
  usePageMeta("Request a demo", "Book 30 minutes with the BugBerry team: we record a real bug on your app, send it to your tracker and hand it to an AI agent, live.")
  return (
    <SiteNavigation>
      <DemoView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} submit={api.requestDemo} />
    </SiteNavigation>
  )
}
