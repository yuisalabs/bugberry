import type { ReportTrackers, TrackerLink } from "./api"

/** The server lets another send take over a link that has been "being sent" for this long. */
const STALE_SEND_MS = 2 * 60 * 1000
const POLL_MS = 3000

export type LinkState = "none" | "sent" | "failed" | "sending" | "stalled"

export function linkState(link: TrackerLink | undefined, now: number): LinkState {
  if (!link) return "none"
  if (link.externalId) return "sent"
  if (link.error) return "failed"
  return now - new Date(link.updatedAt).getTime() > STALE_SEND_MS ? "stalled" : "sending"
}

/** Polls while a send (often an auto-send right after upload) is still running, so its result shows up. */
export function trackersRefetchInterval(data: ReportTrackers | undefined, now: number): number | false {
  return data?.links.some((link) => linkState(link, now) === "sending") ? POLL_MS : false
}
