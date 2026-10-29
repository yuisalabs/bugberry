import { useRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { RouterProvider } from "react-aria-components"

/** Paths on this host that the app does not serve: the docs site, the API, OAuth discovery and static files. */
const OUTSIDE_THE_APP = /^\/(docs|api|\.well-known|assets)(\/|$)/

/**
 * Opens a link of the public site: pages of the app go through the router (no reload), anything else (the docs
 * on the same host, other sites) loads in full.
 */
export function openSiteLink(href: string, how: { origin: string; navigate: (to: string) => void; load: (to: string) => void }): void {
  const url = new URL(href, how.origin)
  if (url.origin !== how.origin || OUTSIDE_THE_APP.test(url.pathname)) return how.load(href)
  how.navigate(`${url.pathname}${url.search}${url.hash}`)
}

/** Lets the public site's links (react-aria `Link`) move between pages without reloading the app. */
export function SiteNavigation({ children }: { children: ReactNode }) {
  const router = useRouter()
  const navigate = (href: string) =>
    openSiteLink(href, {
      origin: window.location.origin,
      navigate: (to) => void router.navigate({ href: to }),
      load: (to) => window.location.assign(to),
    })
  return <RouterProvider navigate={navigate}>{children}</RouterProvider>
}
