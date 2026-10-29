import type { DemoRequestInput } from "@bugberry/shared"
import { escapeHtml } from "../../lib/email/escape"

const BERRY = "#D61F69"
const INK = "#1C1022"
const MUTED = "#635A6B"

/** The email the team gets for each demo request, as HTML and plain text. Every field is typed by a visitor. */
export function demoRequestEmail(input: DemoRequestInput & { receivedAt: Date }): {
  subject: string
  html: string
  text: string
} {
  const name = `${input.firstName} ${input.lastName}`
  const subject = `Demo request: ${input.company} (${name})`
  const fields: Array<[string, string]> = [
    ["Name", name],
    ["Work email", input.email],
    ["Company", input.company],
    ["Issue tracker", input.tracker],
    ["Team size", input.teamSize],
    ["Self-hosting", input.selfHosting ? "yes" : "no"],
    ["Received", input.receivedAt.toISOString()],
  ]
  const text = [
    `${name} from ${input.company} asked for a demo.`,
    "",
    ...fields.map(([label, value]) => `${label}: ${value}`),
    "",
    "What they would like to see:",
    input.message || "(nothing written)",
    "",
    "Reply to them within one business day.",
  ].join("\n")
  const rows = fields
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;font-size:14px;color:${MUTED};white-space:nowrap">${label}</td><td style="padding:4px 0;font-size:14px">${escapeHtml(value)}</td></tr>`,
    )
    .join("")
  const message = input.message ? escapeHtml(input.message).replace(/\n/g, "<br>") : `<span style="color:${MUTED}">(nothing written)</span>`
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#F7F6FA;font-family:'DM Sans',Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E1EC;border-radius:16px;padding:32px">
      <tr><td style="font-size:20px;font-weight:700;color:${BERRY}">BugBerry</td></tr>
      <tr><td style="padding-top:20px;font-size:16px"><strong>${escapeHtml(name)}</strong> from <strong>${escapeHtml(input.company)}</strong> asked for a demo.</td></tr>
      <tr><td style="padding-top:16px"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
      <tr><td style="padding-top:16px;font-size:14px;color:${MUTED}">What they would like to see</td></tr>
      <tr><td style="padding-top:4px;font-size:14px">${message}</td></tr>
      <tr><td style="padding-top:20px;font-size:13px;color:${MUTED}">Reply to them within one business day.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  return { subject, html, text }
}
