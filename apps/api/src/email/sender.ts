import nodemailer from "nodemailer"
import type { EmailConfig } from "../config"

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

export interface SmtpOptions {
  host: string
  port: number
  secure: boolean
  auth?: { user: string; pass: string }
}

interface SmtpTransport {
  sendMail(mail: object): Promise<unknown>
}

export interface EmailSenderDeps {
  fetch?: typeof fetch
  smtpTransport?: (options: SmtpOptions) => SmtpTransport
  log?: (line: string) => void
}

const RESEND_URL = "https://api.resend.com/emails"

/** Sends through Resend, an SMTP server, or (development only) prints the message to the log. */
export function createEmailSender(config: EmailConfig, deps: EmailSenderDeps = {}): EmailSender {
  if (config.driver === "resend") {
    const fetcher = deps.fetch ?? fetch
    return {
      async send(message) {
        const response = await fetcher(RESEND_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
        })
        if (!response.ok) throw new Error(`Resend refused the email (HTTP ${response.status})`)
      },
    }
  }
  if (config.driver === "smtp") {
    const options: SmtpOptions = {
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.password ?? "" } } : {}),
    }
    const transport = (deps.smtpTransport ?? ((opts: SmtpOptions) => nodemailer.createTransport(opts)))(options)
    return {
      async send(message) {
        await transport.sendMail({ from: config.from, ...message })
      },
    }
  }
  const log = deps.log ?? ((line: string) => console.info(line))
  return {
    async send(message) {
      log(`[email] to=${message.to} subject=${message.subject}\n${message.text}`)
    },
  }
}
