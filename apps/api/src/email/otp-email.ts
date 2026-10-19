const BERRY = "#D61F69"
const INK = "#1C1022"
const MUTED = "#635A6B"

/** The sign-in code email, as HTML and plain text. The code is digits only, so it needs no escaping. */
export function otpEmail(code: string, minutes: number): { subject: string; html: string; text: string } {
  const text = [
    `Your BugBerry sign-in code is ${code}.`,
    "",
    `This code expires in ${minutes} minutes.`,
    "",
    "If you didn't ask for this, you can ignore this email.",
  ].join("\n")
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#F7F6FA;font-family:'DM Sans',Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E1EC;border-radius:16px;padding:32px">
      <tr><td style="font-size:20px;font-weight:700;color:${BERRY}">BugBerry</td></tr>
      <tr><td style="padding-top:20px;font-size:16px">Your sign-in code:</td></tr>
      <tr><td style="padding:12px 0;font-family:'Geist Mono',Menlo,monospace;font-size:32px;letter-spacing:6px;font-weight:700">${code}</td></tr>
      <tr><td style="font-size:14px;color:${MUTED}">This code expires in ${minutes} minutes.</td></tr>
      <tr><td style="padding-top:20px;font-size:13px;color:${MUTED}">If you didn't ask for this, you can ignore this email.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  return { subject: `Your BugBerry sign-in code: ${code}`, html, text }
}
