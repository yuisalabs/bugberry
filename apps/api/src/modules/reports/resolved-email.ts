import { fixLinkLabel } from "@bugberry/shared"
import { escapeHtml } from "../../lib/email/escape"

const BERRY = "#D61F69"
const INK = "#1C1022"
const MUTED = "#635A6B"

/** "Your report is resolved", to the person who reported it: who fixed it, where, and their note. Every value is escaped. */
export function resolvedEmail(input: {
  actorName: string
  reportNumber: number
  reportTitle: string
  links: string[]
  note: string | null
  url: string
  /** The AI app that resolved it through MCP, when one did. */
  viaAgent?: string | null
}): { subject: string; html: string; text: string } {
  const where = `BB-${input.reportNumber}`
  const who = input.viaAgent ? `${input.actorName} (via ${input.viaAgent})` : input.actorName
  const links = input.links.map((url) => ({ url, label: fixLinkLabel(url).label }))
  const text = [
    `${who} resolved ${where} · ${input.reportTitle}`,
    "",
    "Fixed in:",
    ...links.map((link) => `- ${link.label} ${link.url}`),
    ...(input.note ? ["", input.note] : []),
    "",
    `Open report: ${input.url}`,
  ].join("\n")
  const linkRows = links
    .map(
      (link) =>
        `<tr><td style="padding-top:6px;font-size:14px"><a href="${escapeHtml(link.url)}" style="color:${BERRY}">${escapeHtml(link.label)}</a></td></tr>`,
    )
    .join("\n      ")
  const note = input.note
    ? `<tr><td style="padding-top:16px"><div style="border-left:3px solid ${BERRY};padding:8px 12px;font-size:14px;color:${INK};white-space:pre-wrap">${escapeHtml(input.note)}</div></td></tr>`
    : ""
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#F7F6FA;font-family:'DM Sans',Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E1EC;border-radius:16px;padding:32px">
      <tr><td style="font-size:20px;font-weight:700;color:${BERRY}">BugBerry</td></tr>
      <tr><td style="padding-top:20px;font-size:16px">${escapeHtml(who)} resolved <strong>${where}</strong> · ${escapeHtml(input.reportTitle)}</td></tr>
      <tr><td style="padding-top:16px;font-size:14px;color:${MUTED}">Fixed in:</td></tr>
      ${linkRows}
      ${note}
      <tr><td style="padding:24px 0"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:${BERRY};color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">Open report</a></td></tr>
      <tr><td style="font-size:13px;color:${MUTED}">You get this email because you reported this bug.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  return { subject: `${where} is resolved: ${input.reportTitle}`, html, text }
}
