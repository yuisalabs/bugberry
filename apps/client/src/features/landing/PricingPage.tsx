import { useQuery } from "@tanstack/react-query"
import { PricingView } from "./PricingView"
import { SiteNavigation } from "./SiteNavigation"
import { usePageMeta } from "./usePageMeta"
import { authQueries } from "../auth/queries"
import { accountQueries } from "../account/queries"

/** `/pricing` on BugBerry cloud. */
export function PricingPage() {
  const me = useQuery({ ...accountQueries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(authQueries.clientConfig())
  usePageMeta("Pricing", "BugBerry is free while we’re in early access: 5 screenshots and 5 video recordings per workspace, or self-host with no limits.")
  return (
    <SiteNavigation>
      <PricingView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} />
    </SiteNavigation>
  )
}
