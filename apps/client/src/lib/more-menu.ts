import { PROVIDER_LABELS } from "@bugberry/shared"
import type { ReportTrackers } from "./api"
import { linkState } from "./tracker-links"
import { safeHttpUrl } from "./urls"

/** What a person pastes into their AI agent to have it debug this report through the MCP server. */
export function copyForAiText(origin: string, reportId: string): string {
  return `Use the BugBerry MCP server to debug this report: ${origin}/app/r/${reportId}`
}

export interface TrackerItem {
  integrationId: string
  label: string
  /** "none": nothing to do while a send runs. */
  action: "send" | "retry" | "open" | "none"
  href: string | null
  note: string | null
}

/**
 * The ⋯ menu's tracker items: send, follow a send, retry it, or open the issue it made.
 * `sendingId` is a send this page started that the server has not answered yet.
 */
export function trackerItems(data: ReportTrackers, now: number, sendingId: string | null = null): TrackerItem[] {
  // Issues created through another project's integration, before the report was moved; still worth a link.
  const earlier = data.links
    .filter((link) => link.externalId && !data.integrations.some((item) => item.id === link.integrationId))
    .map((link) => ({
      integrationId: link.integrationId,
      label: `Open issue #${link.externalId}`,
      action: "open" as const,
      href: link.externalUrl ? safeHttpUrl(link.externalUrl) : null,
      note: "Created before the report moved projects",
    }))

  const current = data.integrations.map((integration): TrackerItem => {
    const provider = PROVIDER_LABELS[integration.provider]
    const link = data.links.find((entry) => entry.integrationId === integration.id)
    const item = { integrationId: integration.id, href: null, note: null }
    switch (integration.id === sendingId ? "sending" : linkState(link, now)) {
      case "sent":
        return {
          ...item,
          label: `Open in ${provider} #${link?.externalId}`,
          action: "open",
          href: link?.externalUrl ? safeHttpUrl(link.externalUrl) : null,
        }
      case "sending":
        return { ...item, label: `Sending to ${provider}…`, action: "none" }
      case "failed":
        return { ...item, label: `Retry send to ${provider}`, action: "retry", note: link?.error ?? null }
      case "stalled":
        return { ...item, label: `Retry send to ${provider}`, action: "retry", note: "The earlier send didn't finish." }
      default:
        return { ...item, label: `Send to ${provider} · ${integration.label}`, action: "send" }
    }
  })
  return [...earlier, ...current]
}
