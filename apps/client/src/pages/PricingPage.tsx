import { useQuery } from "@tanstack/react-query"
import { queries } from "../lib/queries"
import { PricingView } from "./landing/PricingView"
import { usePageMeta } from "./landing/usePageMeta"

/** `/pricing` on BugBerry cloud. */
export function PricingPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(queries.clientConfig())
  usePageMeta("Pricing", "BugBerry is free while we’re in early access: 5 screenshots and 5 video recordings per workspace, or self-host with no limits.")
  return <PricingView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} />
}
