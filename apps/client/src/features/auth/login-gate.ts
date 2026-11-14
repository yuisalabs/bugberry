import { redirect } from "@tanstack/react-router"
import type { RouterContext } from "../../router"
import { accountQueries, type Me } from "../account/queries"
import { safeNext } from "../../lib/urls"
import { loginTarget, oauthResumeUrl } from "./oauth"
import type { LoginSearch } from "./login"

/** How long sign-in waits to learn whether someone is signed in before showing the form anyway. */
const SESSION_WAIT_MS = 1500

/**
 * Someone already signed in skips the sign-in form and goes on to where they were going, decided before the
 * page renders so the form never flashes. A sign-in that failed (`error`) shows the form with its message.
 */
export async function signedInLoginGate({
  context,
  search,
  browser = window.location,
}: {
  context: RouterContext
  search: LoginSearch
  browser?: { search: string; assign(url: string): void }
}): Promise<void> {
  if (search.error) return
  // A 401 here is the answer "signed out", not a session that ended mid-use.
  const session = context.queryClient
    .fetchQuery({ ...accountQueries.me(), retry: false, meta: { signedOutIsFine: true } })
    .catch(() => null)
  const giveUp = new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_WAIT_MS))
  const me: Me | null = await Promise.race([session, giveUp])
  if (!me) return
  if (oauthResumeUrl(browser.search)) {
    // The AI app's authorize endpoint is on the server, outside the router.
    browser.assign(loginTarget(browser.search, search.next))
    return new Promise<never>(() => {})
  }
  throw redirect({ href: safeNext(search.next), replace: true })
}
