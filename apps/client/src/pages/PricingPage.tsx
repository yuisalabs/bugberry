import { useQuery } from "@tanstack/react-query"
import { PricingView } from "./landing/PricingView"
import { SiteNavigation } from "./landing/SiteNavigation"
import { usePageMeta } from "./landing/usePageMeta"
import { authQueries } from "../features/auth/queries"
import { queries } from "../lib/queries"

/** `/pricing` on BugBerry cloud. */
export function PricingPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(authQueries.clientConfig())
  usePageMeta("Pricing", "BugBerry is free while we’re in early access: 5 screenshots and 5 video recordings per workspace, or self-host with no limits.")
  return (
    <SiteNavigation>
      <PricingView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} />
    </SiteNavigation>
  )
}
