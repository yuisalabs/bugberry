import { createHmac } from "node:crypto"
import type { NotifierConfig, NotifierProvider, TelegramConfig, WebhookConfig } from "@bugberry/shared"
import { type HostGuard, NO_GUARD } from "../net/host-guard"
import { DEFAULT_TIMEOUT_MS, guardedSend, type Http, TrackerError } from "../trackers/providers"
import { messageHeading, messageLines, type NewReportMessage } from "./message"

export interface NotifierClient {
  send(message: NewReportMessage): Promise<void>
}

export type NotifierFactory = (provider: NotifierProvider, config: NotifierConfig, secret: string) => NotifierClient

async function post(http: Http, name: string, url: string, body: string, headers: Record<string, string> = {}) {
  const response = await guardedSend(http, name, url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "BugBerry", ...headers },
    body,
  }).catch((error: unknown) => {
    // The tracker wording ("the issue may have been created") doesn't fit a message.
    if (error instanceof TrackerError && error.message.startsWith(`${name} did not respond`)) {
      throw new TrackerError(`${name} did not respond`)
    }
    throw error
  })
  if (response.ok) {
    await response.body?.cancel()
    return
  }
  throw new TrackerError(`${name} rejected the message (HTTP ${response.status})${await telegramReason(name, response)}`)
}

async function telegramReason(name: string, response: Response): Promise<string> {
  if (name !== "Telegram") {
    await response.body?.cancel()
    return ""
  }
  const body = (await response.json().catch(() => ({}))) as { description?: unknown }
  return typeof body.description === "string" ? `: ${body.description.slice(0, 200)}` : ""
}

/** Slack's mrkdwn turns <...> into links and mentions; escaped, the report's text stays text. */
function slackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Discord renders markdown in embed titles and fields, masked links included; a backslash keeps each mark literal. */
function discordText(value: string): string {
  return value.replace(/[\\*_~`|>[\]()#-]/g, "\\$&")
}

function htmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function slackClient(webhookUrl: string, http: Http): NotifierClient {
  return {
    async send(message) {
      const heading = slackText(messageHeading(message))
      const lines = messageLines(message).map(slackText)
      const body = {
        text: heading,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*${heading}*` } },
          { type: "context", elements: lines.map((line) => ({ type: "mrkdwn", text: line })) },
          {
            type: "actions",
            elements: [{ type: "button", text: { type: "plain_text", text: "Open in BugBerry" }, url: message.reportUrl }],
          },
        ],
      }
      await post(http, "Slack", webhookUrl, JSON.stringify(body))
    },
  }
}

function discordClient(webhookUrl: string, http: Http): NotifierClient {
  return {
    async send(message) {
      const [where, details] = messageLines(message).map(discordText)
      const fields = message.test
        ? []
        : [
            { name: "Project", value: discordText(message.projectName), inline: true },
            { name: "Reported by", value: discordText(message.reporterName), inline: true },
            ...(details ? [{ name: "Details", value: details }] : []),
          ]
      const body = {
        embeds: [
          {
            title: messageHeading(message, discordText),
            url: message.reportUrl,
            ...(message.test ? { description: where } : {}),
            fields,
            timestamp: message.createdAt.toISOString(),
          },
        ],
        allowed_mentions: { parse: [] },
      }
      await post(http, "Discord", webhookUrl, JSON.stringify(body))
    },
  }
}

function telegramClient(config: TelegramConfig, token: string, http: Http): NotifierClient {
  return {
    async send(message) {
      const text = [
        `<b>${htmlText(messageHeading(message))}</b>`,
        ...messageLines(message).map(htmlText),
        `<a href="${htmlText(message.reportUrl)}">Open in BugBerry</a>`,
      ].join("\n")
      const body = { chat_id: config.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }
      await post(http, "Telegram", `https://api.telegram.org/bot${token}/sendMessage`, JSON.stringify(body))
    },
  }
}

function webhookClient(config: WebhookConfig, secret: string, http: Http): NotifierClient {
  return {
    async send(message) {
      const body = JSON.stringify({
        event: "report.created",
        sentAt: new Date().toISOString(),
        report: {
          id: message.reportId,
          number: message.number,
          title: message.title,
          project: message.projectName,
          reporter: message.reporterName,
          browser: message.browser,
          consoleErrors: message.consoleErrors,
          failedRequests: message.failedRequests,
          pageUrl: message.pageUrl,
          url: message.reportUrl,
          createdAt: message.createdAt.toISOString(),
        },
        test: message.test === true,
      })
      const headers: Record<string, string> = { "x-bugberry-event": "report.created" }
      if (secret) headers["x-bugberry-signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
      await post(http, "The webhook", config.url, body, headers)
    },
  }
}

export function createNotifierFactory(
  fetcher: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  guard: HostGuard = NO_GUARD,
): NotifierFactory {
  const http = { fetcher, timeoutMs, guard }
  return (provider, config, secret) => {
    if (provider === "slack") return slackClient(secret, http)
    if (provider === "discord") return discordClient(secret, http)
    // Slack and Discord's empty config type stops `in` from narrowing, so the shape is checked by hand.
    const settings = config as Partial<TelegramConfig & WebhookConfig>
    if (provider === "telegram" && typeof settings.chatId === "string") {
      return telegramClient({ chatId: settings.chatId }, secret, http)
    }
    if (provider === "webhook" && typeof settings.url === "string") return webhookClient({ url: settings.url }, secret, http)
    throw new TrackerError("The integration settings don't match its provider")
  }
}
