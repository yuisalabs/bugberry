import { escapeHtml } from "../../lib/email/escape"

const BERRY = "#D61F69"
const INK = "#1C1022"
const MUTED = "#635A6B"

/** "The recording you asked for arrived", to the member who made the link. Every value is escaped. */
export function receivedEmail(input: {
  senderName: string
  reportNumber: number
  reportTitle: string
  reportUrl: string
  workspaceName: string
}): { subject: string; text: string; html: string } {
  const where = `BB-${input.reportNumber}`
  const text = [
    `${input.senderName} sent the recording you asked for: ${where} · ${input.reportTitle}`,
    "",
    `They used your request link in ${input.workspaceName}. It isn't sent to any tracker until someone on the team does it.`,
    "",
    `Open report: ${input.reportUrl}`,
  ].join("\n")
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#F7F6FA;font-family:'DM Sans',Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E1EC;border-radius:16px;padding:32px">
      <tr><td style="font-size:20px;font-weight:700;color:${BERRY}">BugBerry</td></tr>
      <tr><td style="padding-top:20px;font-size:16px">${escapeHtml(input.senderName)} sent the recording you asked for: <strong>${where}</strong> · ${escapeHtml(input.reportTitle)}</td></tr>
      <tr><td style="padding-top:12px;font-size:14px;color:${MUTED}">They used your request link in ${escapeHtml(input.workspaceName)}. It isn't sent to any tracker until someone on the team does it.</td></tr>
      <tr><td style="padding:24px 0"><a href="${escapeHtml(input.reportUrl)}" style="display:inline-block;background:${BERRY};color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">Open report</a></td></tr>
      <tr><td style="font-size:13px;color:${MUTED}">You get this email because you asked for this recording.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  // The name is whatever the sender typed, so it stays out of the subject, where it would read as BugBerry's words.
  return { subject: `The recording you asked for arrived (${where})`, text, html }
}
