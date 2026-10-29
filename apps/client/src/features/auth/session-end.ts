import type { QueryClient } from "@tanstack/react-query"
import { accountQueries, type Me } from "../account/queries"

/** Who was signed in when the session ended, for the 401 page's ticket. Kept in memory only, never in the URL. */
export interface SessionEnd {
  name: string | null
  email: string | null
  at: Date
}

let last: SessionEnd | null = null

export function lastSessionEnd(): SessionEnd | null {
  return last
}

/**
 * Where a 401 sends the person. Someone who was signed in (their session ended mid-use) gets the 401 page, which
 * says so; someone who never was (an internal share link) goes straight to sign-in. Null on those two pages.
 */
export function sessionEndTarget(
  queryClient: QueryClient,
  location: { pathname: string; href: string },
  at = new Date(),
): { to: "/session-ended" | "/login"; search: { next: string } } | null {
  if (location.pathname === "/login" || location.pathname === "/session-ended") return null
  const me = queryClient.getQueryData<Me>(accountQueries.me().queryKey)
  if (!me) return { to: "/login", search: { next: location.href } }
  last = { name: me.name || null, email: me.email || null, at }
  // The old session's answer goes, so the dashboard asks again after the next sign-in.
  queryClient.removeQueries({ queryKey: accountQueries.me().queryKey })
  return { to: "/session-ended", search: { next: location.href } }
}
