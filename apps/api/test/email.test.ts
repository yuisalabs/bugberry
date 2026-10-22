import { describe, expect, test } from "bun:test"
import { otpEmail } from "../src/email/otp-email"
import { createEmailSender } from "../src/email/sender"

describe("otpEmail", () => {
  test("the OTP email carries the code, its lifetime and a way out", () => {
    const mail = otpEmail("123456", 10)
    expect(mail.subject).toBe("Your BugBerry sign-in code: 123456")
    expect(mail.text).toContain("123456")
    expect(mail.text).toContain("expires in 10 minutes")
    expect(mail.text).toContain("If you didn't ask for this, you can ignore this email.")
    expect(mail.html).toContain("123456")
    expect(mail.html).toContain("BugBerry")
  })
})

describe("createEmailSender", () => {
  test("Resend is called with the API key and the message", async () => {
    const requests: Request[] = []
    const fetcher = (async (input: string, init: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json({ id: "1" })
    }) as unknown as typeof fetch
    await createEmailSender({ driver: "resend", from: "BugBerry <a@b.c>", apiKey: "re_1" }, { fetch: fetcher }).send({
      to: "x@y.z",
      subject: "S",
      html: "<p>H</p>",
      text: "T",
    })
    expect(requests[0]?.url).toBe("https://api.resend.com/emails")
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer re_1")
    expect(await requests[0]?.json()).toEqual({ from: "BugBerry <a@b.c>", to: ["x@y.z"], subject: "S", html: "<p>H</p>", text: "T" })
  })

  test("a reply goes where the message says, through Resend and SMTP", async () => {
    const requests: Request[] = []
    const fetcher = (async (input: string, init: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json({ id: "1" })
    }) as unknown as typeof fetch
    const message = { to: "team@b.c", replyTo: "visitor@d.e", subject: "S", html: "H", text: "T" }
    await createEmailSender({ driver: "resend", from: "a@b.c", apiKey: "re_1" }, { fetch: fetcher }).send(message)
    expect(await requests[0]?.json()).toMatchObject({ to: ["team@b.c"], reply_to: ["visitor@d.e"] })
    const sent: object[] = []
    const smtp = createEmailSender(
      { driver: "smtp", from: "a@b.c", host: "smtp.b.c", port: 587, user: null, password: null, secure: false },
      { smtpTransport: () => ({ sendMail: async (mail: object) => void sent.push(mail) }) },
    )
    await smtp.send(message)
    expect(sent[0]).toMatchObject({ to: "team@b.c", replyTo: "visitor@d.e" })
  })

  test("a refused Resend call is an error", async () => {
    const fetcher = (async () => Response.json({ message: "bad" }, { status: 422 })) as unknown as typeof fetch
    const sender = createEmailSender({ driver: "resend", from: "a@b.c", apiKey: "re_1" }, { fetch: fetcher })
    expect(sender.send({ to: "x@y.z", subject: "S", html: "H", text: "T" })).rejects.toThrow(/422/)
  })

  test("SMTP sends through the configured transport", async () => {
    const sent: object[] = []
    const options: object[] = []
    const sender = createEmailSender(
      { driver: "smtp", from: "a@b.c", host: "smtp.b.c", port: 587, user: "u", password: "p", secure: false },
      {
        smtpTransport: (opts) => {
          options.push(opts)
          return { sendMail: async (mail: object) => void sent.push(mail) }
        },
      },
    )
    await sender.send({ to: "x@y.z", subject: "S", html: "H", text: "T" })
    expect(options[0]).toMatchObject({ host: "smtp.b.c", port: 587, secure: false, auth: { user: "u", pass: "p" } })
    expect(sent[0]).toMatchObject({ from: "a@b.c", to: "x@y.z", subject: "S", html: "H", text: "T" })
  })

  test("the development log prints the message instead of sending it", async () => {
    const lines: string[] = []
    await createEmailSender({ driver: "log", from: "a@b.c" }, { log: (line) => void lines.push(line) }).send({
      to: "x@y.z",
      subject: "S",
      html: "H",
      text: "code 123456",
    })
    expect(lines.join("\n")).toContain("to=x@y.z")
    expect(lines.join("\n")).toContain("code 123456")
  })
})
