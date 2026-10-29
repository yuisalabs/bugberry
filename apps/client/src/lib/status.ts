import { ApiError } from "./query/unwrap"

/** The status pages (components/status): one per kind of failure a whole page can run into. */
export type StatusKind = "400" | "401" | "403" | "404" | "500" | "503" | "504" | "maintenance"

/**
 * Which status page an error gets. A server that can't be reached, or nginx with no api behind it (502), is a 503;
 * a crash in the page itself, or an answer none of the pages fits, is a 500.
 */
export function statusKind(error: unknown): StatusKind {
  if (!(error instanceof ApiError)) return "500"
  if (error.code === "maintenance") return "maintenance"
  if (error.code === "network") return "503"
  switch (error.status) {
    case 400:
    case 422:
      return "400"
    case 401:
    case 403:
    case 404:
    case 504:
      return String(error.status) as StatusKind
    case 502:
    case 503:
      return "503"
    default:
      return "500"
  }
}

export interface Maintenance {
  message: string | null
  until: Date | null
}

/**
 * The maintenance notice nginx answers with while maintenance.json is in place (docker/nginx.conf): its optional
 * `message` and `until` (an ISO time). A time that doesn't parse is left out rather than guessed.
 */
export function maintenanceOf(error: unknown): Maintenance | null {
  if (!(error instanceof ApiError) || error.code !== "maintenance") return null
  const { message, until } = error.body
  // Eden turns an ISO string in a response into a Date on its own.
  const date = until instanceof Date ? until : typeof until === "string" ? new Date(until) : null
  return {
    message: typeof message === "string" && message.trim() ? message.trim() : null,
    until: date && !Number.isNaN(date.getTime()) ? date : null,
  }
}
