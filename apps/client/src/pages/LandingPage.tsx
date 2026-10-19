import { useQuery } from "@tanstack/react-query"
import { queries } from "../lib/queries"
import { LandingView } from "./landing/LandingView"

/** `/`: the public landing page. A signed-in visitor is offered the dashboard instead of sign-up. */
export function LandingPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  return <LandingView signedIn={me.isSuccess} />
}
