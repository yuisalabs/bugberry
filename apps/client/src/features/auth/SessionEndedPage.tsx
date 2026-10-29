import { getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { StatusPage } from "../../components/layout/StatusPage"
import { lastSessionEnd } from "./session-end"
import { safeNext } from "../../lib/urls"

const routeApi = getRouteApi("/session-ended")

/**
 * `/session-ended?next=…`: where a 401 sends someone whose session ended mid-use (lib/session-end). The ticket names
 * who was signed in while this tab still remembers it; after a reload it shows only where they were going.
 */
export function SessionEndedPage() {
  const { next } = routeApi.useSearch()
  const target = safeNext(next)
  const [end] = useState(lastSessionEnd)
  return (
    <StatusPage
      kind="401"
      signInHref={`/login?next=${encodeURIComponent(target)}`}
      ticket={{ holder: end?.name ?? null, account: end?.email ?? null, gate: new URL(target, window.location.origin).pathname, ended: end?.at ?? null }}
    />
  )
}
