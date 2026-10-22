import { redirect } from "@tanstack/react-router"
import { queries } from "./queries"
import type { RouterContext } from "../router"

/**
 * The marketing pages exist only on BugBerry cloud (PUBLIC_SITE). A self-hosted server sends them to sign-in,
 * which goes on to the dashboard for someone signed in. Settings that can't be read show the page: an API
 * hiccup on the cloud should not blank its home page.
 */
export async function publicSiteGate({ context }: { context: RouterContext }): Promise<void> {
  const config = await context.queryClient.ensureQueryData(queries.clientConfig()).catch(() => null)
  if (config?.publicSite === false) throw redirect({ to: "/login" })
}
