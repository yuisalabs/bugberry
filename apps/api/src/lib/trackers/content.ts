import type { CaptureType, DebuggerSummary, DeviceInfo } from "@bugberry/shared"

export interface IssueReport {
  id: string
  title: string
  description: string
  pageUrl: string
  pageTitle: string
  captureType: CaptureType
  device: DeviceInfo
  debuggerSummary: DebuggerSummary
}

export interface IssueContent {
  title: string
  /** Written by a team member; rendered as normal text. */
  description: string
  /** Label/value pairs. Values may come from the captured page and are always rendered inert. */
  facts: Array<[string, string]>
  /** Error text from the captured page. */
  errors: string[]
  reportUrl: string
}

export function buildIssueContent(report: IssueReport, errors: string[], appUrl: string): IssueContent {
  const facts: Array<[string, string]> = [["Page", report.pageUrl]]
  if (report.pageTitle) facts.push(["Page title", report.pageTitle])
  facts.push(
    ["Browser", report.device.browser],
    ["OS", report.device.os],
    ["Viewport", report.device.viewport],
    ["Type", report.captureType === "video" ? "Video" : "Screenshot"],
    ["Console errors", String(report.debuggerSummary.errors)],
    ["Failed requests", String(report.debuggerSummary.failedRequests)],
  )
  return {
    title: report.title,
    description: report.description,
    facts,
    errors,
    reportUrl: `${appUrl}/app/r/${encodeURIComponent(report.id)}`,
  }
}

/** Inline code cannot contain a backtick or a line break; inside it, @mentions and links stay plain text. */
function inlineCode(value: string): string {
  const cleaned = value.replace(/`/g, "").replace(/\s+/g, " ").trim()
  return `\`${cleaned || " "}\``
}

/** A fence longer than any backtick run in the text, so the text cannot end the block. */
function fenced(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = "`".repeat(Math.max(3, longestRun + 1))
  return `${fence}\n${text}\n${fence}`
}

/**
 * The description is quoted line by line: a fence, HTML block or comment it leaves open ends with
 * the quote, so it cannot swallow the page data below and turn it into live markdown.
 */
function quoted(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
}

export function renderMarkdown(content: IssueContent): string {
  const description = content.description.trim()
  const parts = [description ? quoted(description) : "_No description._", "", "**Summary**"]
  for (const [label, value] of content.facts) parts.push(`- **${label}:** ${inlineCode(value)}`)
  if (content.errors.length > 0) {
    parts.push("", "**First errors**")
    for (const error of content.errors) parts.push(fenced(error))
  }
  parts.push("", `[Open the report in BugBerry](${content.reportUrl})`)
  return parts.join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function renderHtml(content: IssueContent): string {
  const description = content.description.trim()
    ? escapeHtml(content.description.trim()).replace(/\r?\n/g, "<br>")
    : "<em>No description.</em>"
  const facts = content.facts.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
  const parts = [`<p>${description}</p>`, "<p><strong>Summary</strong></p>", `<ul>${facts.join("")}</ul>`]
  if (content.errors.length > 0) {
    parts.push("<p><strong>First errors</strong></p>")
    for (const error of content.errors) parts.push(`<pre>${escapeHtml(error)}</pre>`)
  }
  parts.push(`<p><a href="${escapeHtml(content.reportUrl)}">Open the report in BugBerry</a></p>`)
  return parts.join("")
}
