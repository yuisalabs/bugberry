import type { DebuggerSummary, DeviceInfo } from "@bugberry/shared"

/** What every channel says about a new report. Chat channels never show `pageUrl`; the webhook does. */
export interface NewReportMessage {
  reportId: string
  number: number
  title: string
  projectName: string
  reporterName: string
  browser: string
  consoleErrors: number
  failedRequests: number
  reportUrl: string
  /** The captured page, which may carry tokens in its query string. Only the webhook sends it. */
  pageUrl: string
  createdAt: Date
  /** Sent from "Send test message", not from a real report. */
  test?: boolean
}

export interface NewReportRow {
  id: string
  number: number
  title: string
  pageUrl: string
  device: DeviceInfo
  debuggerSummary: DebuggerSummary
  createdAt: Date
}

export function buildNewReportMessage(
  row: NewReportRow,
  projectName: string,
  reporterName: string,
  appUrl: string,
): NewReportMessage {
  return {
    reportId: row.id,
    number: row.number,
    title: row.title,
    projectName,
    reporterName,
    browser: row.device.browser,
    consoleErrors: row.debuggerSummary.errors,
    failedRequests: row.debuggerSummary.failedRequests,
    reportUrl: `${appUrl}/app/r/${encodeURIComponent(row.id)}`,
    pageUrl: row.pageUrl,
    createdAt: row.createdAt,
  }
}

export function testMessage(projectName: string, appUrl: string): NewReportMessage {
  return {
    reportId: "test",
    number: 0,
    title: "BugBerry test message",
    projectName,
    reporterName: "BugBerry",
    browser: "",
    consoleErrors: 0,
    failedRequests: 0,
    reportUrl: `${appUrl}/app`,
    pageUrl: "",
    createdAt: new Date(),
    test: true,
  }
}

const MAX_TITLE = 200

/** "BB-42 · Pay now fails", or the test message's own title. `escape` makes the title inert for the channel. */
export function messageHeading(message: NewReportMessage, escape: (text: string) => string = (text) => text): string {
  const title = escape(message.title.length > MAX_TITLE ? `${message.title.slice(0, MAX_TITLE - 1)}…` : message.title)
  return message.test ? title : `BB-${message.number} · ${title}`
}

/** The lines under the heading, as plain text; each channel escapes them its own way. */
export function messageLines(message: NewReportMessage): string[] {
  if (message.test) return [`This integration works. New reports in ${message.projectName} will be posted here.`]
  const counts = [
    message.browser,
    `${message.consoleErrors} console ${message.consoleErrors === 1 ? "error" : "errors"}`,
    `${message.failedRequests} failed ${message.failedRequests === 1 ? "request" : "requests"}`,
  ].filter(Boolean)
  return [`${message.projectName} · reported by ${message.reporterName}`, counts.join(" · ")]
}
