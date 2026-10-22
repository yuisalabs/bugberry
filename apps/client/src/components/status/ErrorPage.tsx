import { useState } from "react"
import { ApiError } from "../../lib/api"
import { maintenanceOf, statusKind } from "../../lib/status"
import { type MarkedRequest, StatusPage } from "./StatusPage"

/** The fields a 422 refused (`details`), as a marked-up request; null when the answer names none. */
function refusedRequest(error: unknown): MarkedRequest | null {
  if (!(error instanceof ApiError) || !Array.isArray(error.body.details)) return null
  const lines = (error.body.details as Array<{ path?: unknown; message?: unknown }>).flatMap((detail) => {
    if (typeof detail.path !== "string") return []
    const field = detail.path.replace(/^\//, "").replaceAll("/", ".") || "body"
    return [{ text: "", mark: field, note: typeof detail.message === "string" ? detail.message : undefined }]
  })
  return lines.length > 0 ? { lines } : null
}

/**
 * The status page for an error a whole page ran into. `description` words a 403 or 404 for what was missing (a
 * report, a share link); `onRetry` is offered where asking again can help.
 */
export function ErrorPage({ error, onRetry, description }: { error: unknown; onRetry?: () => void; description?: string }) {
  // When it failed, for the 504 page's timeline.
  const [at] = useState(() => new Date())
  const kind = statusKind(error)
  switch (kind) {
    case "maintenance": {
      const notice = maintenanceOf(error)
      return <StatusPage kind="maintenance" message={notice?.message} until={notice?.until} />
    }
    case "400":
      return <StatusPage kind="400" request={refusedRequest(error)} />
    case "401": {
      const here = `${window.location.pathname}${window.location.search}`
      return (
        <StatusPage
          kind="401"
          signInHref={`/login?next=${encodeURIComponent(here)}`}
          ticket={{ holder: null, account: null, gate: window.location.pathname, ended: null }}
        />
      )
    }
    case "403":
    case "404":
      return <StatusPage kind={kind} description={description} />
    case "504":
      return <StatusPage kind="504" onRetry={onRetry} waitedMs={error instanceof ApiError ? error.waitedMs : null} at={at} />
    default:
      return <StatusPage kind={kind} onRetry={onRetry} />
  }
}
