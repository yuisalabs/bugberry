import { redirect } from "@tanstack/react-router"
import type { RouterContext } from "../router"
import { authQueries } from "../features/auth/queries"

/** How long a public page waits for the server's settings before showing anyway. */
const SETTINGS_WAIT_MS = 1500

/**
 * The marketing pages exist only on BugBerry cloud (PUBLIC_SITE). A self-hosted server sends them to sign-in,
 * which goes on to the dashboard for someone signed in. Settings that can't be read show the page: an API
 * hiccup on the cloud should not blank its home page.
 */
export async function publicSiteGate({ context }: { context: RouterContext }): Promise<void> {
  // Asked once, and not waited on for long: retries or a hung request would leave the page blank.
  const settings = context.queryClient.ensureQueryData({ ...authQueries.clientConfig(), retry: false }).catch(() => null)
  const giveUp = new Promise<null>((resolve) => setTimeout(() => resolve(null), SETTINGS_WAIT_MS))
  const config = await Promise.race([settings, giveUp])
  if (config?.publicSite === false) throw redirect({ to: "/login" })
}
