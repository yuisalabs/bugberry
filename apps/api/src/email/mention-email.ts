import { escapeHtml } from "./escape"

const BERRY = "#D61F69"
const INK = "#1C1022"
const MUTED = "#635A6B"

/** "Someone mentioned you" email, as HTML and plain text. Names, titles and the comment are escaped. */
export function mentionEmail(input: {
  actorName: string
  reportNumber: number
  reportTitle: string
  snippet: string
  url: string
  /** The AI app that wrote the comment through MCP, when one did. */
  viaAgent?: string | null
}): { subject: string; html: string; text: string } {
  const where = `BB-${input.reportNumber}`
  const who = input.viaAgent ? `${input.actorName} mentioned you (via ${input.viaAgent})` : `${input.actorName} mentioned you`
  const subject = `${who} in ${where}: ${input.reportTitle}`
  const text = [`${who} in ${where} · ${input.reportTitle}`, "", input.snippet, "", `Open report: ${input.url}`].join(
    "\n",
  )
  const actor = escapeHtml(input.actorName)
  const via = input.viaAgent ? ` (via ${escapeHtml(input.viaAgent)})` : ""
  const title = escapeHtml(input.reportTitle)
  const url = escapeHtml(input.url)
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#F7F6FA;font-family:'DM Sans',Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E1EC;border-radius:16px;padding:32px">
      <tr><td style="font-size:20px;font-weight:700;color:${BERRY}">BugBerry</td></tr>
      <tr><td style="padding-top:20px;font-size:16px">${actor} mentioned you${via} in <strong>${where}</strong> · ${title}</td></tr>
      <tr><td style="padding-top:16px"><div style="border-left:3px solid ${BERRY};padding:8px 12px;font-size:14px;color:${INK};white-space:pre-wrap">${escapeHtml(input.snippet)}</div></td></tr>
      <tr><td style="padding:24px 0"><a href="${url}" style="display:inline-block;background:${BERRY};color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">Open report</a></td></tr>
      <tr><td style="font-size:13px;color:${MUTED}">You get this email because someone mentioned you in a comment.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  return { subject, html, text }
}
