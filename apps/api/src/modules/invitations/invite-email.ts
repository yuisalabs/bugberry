import { escapeHtml } from "../../lib/email/escape"

const BERRY = "#D61F69"
const INK = "#1C1022"
const MUTED = "#635A6B"

/** The workspace invitation email, as HTML and plain text. Names are typed by people, so they are escaped. */
export function inviteEmail(input: { workspaceName: string; inviterName: string; url: string; code: string }): {
  subject: string
  html: string
  text: string
} {
  const subject = `${input.inviterName} invited you to ${input.workspaceName} on BugBerry`
  const text = [
    `${input.inviterName} invited you to the ${input.workspaceName} workspace on BugBerry.`,
    "",
    `Join here: ${input.url}`,
    `Or enter this code in BugBerry: ${input.code}`,
    "",
    "The link works for 7 days. If you weren't expecting this, you can ignore this email.",
  ].join("\n")
  const inviter = escapeHtml(input.inviterName)
  const workspace = escapeHtml(input.workspaceName)
  const url = escapeHtml(input.url)
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#F7F6FA;font-family:'DM Sans',Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E1EC;border-radius:16px;padding:32px">
      <tr><td style="font-size:20px;font-weight:700;color:${BERRY}">BugBerry</td></tr>
      <tr><td style="padding-top:20px;font-size:16px">${inviter} invited you to the <strong>${workspace}</strong> workspace.</td></tr>
      <tr><td style="padding:24px 0"><a href="${url}" style="display:inline-block;background:${BERRY};color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">Join ${workspace}</a></td></tr>
      <tr><td style="font-size:14px;color:${MUTED}">Or enter this code in BugBerry: <strong style="font-family:monospace;color:${INK}">${escapeHtml(input.code)}</strong></td></tr>
      <tr><td style="padding-top:8px;font-size:14px;color:${MUTED}">The link works for 7 days.</td></tr>
      <tr><td style="padding-top:20px;font-size:13px;color:${MUTED}">If you weren't expecting this, you can ignore this email.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  return { subject, html, text }
}
