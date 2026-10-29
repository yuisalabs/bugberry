import { RiWebhookLine } from "@remixicon/react"
import { GithubIcon } from "../../features/auth/LoginView"

export type IntegrationKind = "Issues" | "Tickets" | "Tasks" | "Work items" | "Alerts" | "Webhook"

export interface IntegrationInfo {
  name: string
  kind: IntegrationKind
  /** One line for the home page's tile. */
  short: string
}

/** BugBerry's ten integrations (apps/api/src/modules/trackers and modules/notifiers): six trackers, four notifications. */
export const TRACKERS: IntegrationInfo[] = [
  { name: "GitHub", kind: "Issues", short: "Open issues with the errors and a link to the replay" },
  { name: "GitLab", kind: "Issues", short: "Open issues with a link to the full report" },
  { name: "Jira", kind: "Tickets", short: "Create tickets with the page, browser and errors" },
  { name: "Linear", kind: "Issues", short: "Send reports to the right team as issues" },
  { name: "ActiveCollab", kind: "Tasks", short: "Turn reports into tasks in your projects" },
  { name: "Plane", kind: "Work items", short: "File bugs as work items, the replay one click away" },
]
export const NOTIFIERS: IntegrationInfo[] = [
  { name: "Slack", kind: "Alerts", short: "Post every new report to a channel" },
  { name: "Discord", kind: "Alerts", short: "Ping your dev server when a bug lands" },
  { name: "Telegram", kind: "Alerts", short: "Get bug alerts in a group chat" },
  { name: "Webhook", kind: "Webhook", short: "POST each report as JSON to your URL" },
]

const LOGO_FILES: Record<string, string> = {
  GitLab: "/assets/integrations/gitlab.svg",
  Jira: "/assets/integrations/jira.svg",
  Linear: "/assets/integrations/linear.svg",
  ActiveCollab: "/assets/activecollab_icon.png",
  Plane: "/assets/integrations/plane.png",
  Slack: "/assets/integrations/slack.svg",
  Discord: "/assets/integrations/discord.svg",
  Telegram: "/assets/integrations/telegram.svg",
}

/** An integration's logo on a soft tile; GitHub and webhooks are glyphs. */
export function IntegrationLogo({ name, size = 36 }: { name: string; size?: number }) {
  const inner = Math.round(size * 0.56)
  const glyph =
    name === "GitHub" ? (
      // The app's own GitHub mark (also on sign-in and in the integration settings).
      <span className="flex text-[#1C1022] [&>svg]:size-full" style={{ width: inner, height: inner }}>
        <GithubIcon />
      </span>
    ) : name === "Webhook" ? (
      <RiWebhookLine className="text-[#D61F69]" style={{ width: inner, height: inner }} aria-hidden />
    ) : (
      <img src={LOGO_FILES[name]} alt="" className="object-contain" style={{ width: inner, height: inner }} />
    )
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[10px] bg-[#F3F0F6]" style={{ width: size, height: size }}>
      {glyph}
    </span>
  )
}
