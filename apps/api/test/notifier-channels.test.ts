import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { createNotifierFactory } from "../src/modules/notifiers/channels"
import type { NewReportMessage } from "../src/modules/notifiers/message"

const message: NewReportMessage = {
  reportId: "r1",
  number: 42,
  title: "Pay now fails with a 500",
  projectName: "Checkout Web",
  reporterName: "Dana Kim",
  browser: "Chrome 141",
  consoleErrors: 2,
  failedRequests: 1,
  reportUrl: "https://bugberry.kantor.test/app/r/r1",
  pageUrl: "https://shop.kantor.test/checkout?session=9f8a7c&token=secret",
  createdAt: new Date("2026-10-21T08:00:00Z"),
}

function fakeFetch(respond: (request: Request) => Response = () => new Response("ok")) {
  const requests: Request[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)
    return respond(request)
  }) as unknown as typeof fetch
  return { fetcher, requests }
}

describe("Slack", () => {
  test("posts blocks with the report and a link, never the page URL", async () => {
    const { fetcher, requests } = fakeFetch()
    await createNotifierFactory(fetcher)("slack", {}, "https://hooks.slack.com/services/T0/B0/xyz").send(message)
    const request = requests[0] as Request
    expect(request.url).toBe("https://hooks.slack.com/services/T0/B0/xyz")
    const body = await request.text()
    const json = JSON.parse(body) as { text: string; blocks: unknown[] }
    expect(json.text).toContain("BB-42")
    expect(json.blocks.length).toBeGreaterThan(0)
    expect(body).toContain("https://bugberry.kantor.test/app/r/r1")
    expect(body).not.toContain("shop.kantor.test")
  })

  test("a refused message reports the status", async () => {
    const { fetcher } = fakeFetch(() => new Response("invalid_token", { status: 403 }))
    await expect(createNotifierFactory(fetcher)("slack", {}, "https://hooks.slack.com/services/x").send(message)).rejects.toThrow(
      "Slack rejected the message (HTTP 403)",
    )
  })
})

describe("Discord", () => {
  test("posts an embed that mentions nobody, never the page URL", async () => {
    const { fetcher, requests } = fakeFetch(() => new Response(null, { status: 204 }))
    await createNotifierFactory(fetcher)("discord", {}, "https://discord.com/api/webhooks/1/abc").send(message)
    const body = await (requests[0] as Request).text()
    const json = JSON.parse(body) as { embeds: Array<{ title: string; url: string }>; allowed_mentions: { parse: string[] } }
    expect(json.embeds[0]?.title).toBe("BB-42 · Pay now fails with a 500")
    expect(json.embeds[0]?.url).toBe("https://bugberry.kantor.test/app/r/r1")
    expect(json.allowed_mentions.parse).toEqual([])
    expect(body).not.toContain("shop.kantor.test")
  })
})

describe("Telegram", () => {
  test("sends HTML text to the chat through the bot", async () => {
    const { fetcher, requests } = fakeFetch(() => Response.json({ ok: true }))
    await createNotifierFactory(fetcher)("telegram", { chatId: "-1001234" }, "123:bot-token").send(message)
    const request = requests[0] as Request
    expect(request.url).toBe("https://api.telegram.org/bot123:bot-token/sendMessage")
    const json = (await request.json()) as { chat_id: string; text: string; parse_mode: string; disable_web_page_preview: boolean }
    expect(json).toMatchObject({ chat_id: "-1001234", parse_mode: "HTML", disable_web_page_preview: true })
    expect(json.text).toContain("BB-42")
    expect(json.text).not.toContain("shop.kantor.test")
  })

  test("Telegram's own error description is passed on", async () => {
    const { fetcher } = fakeFetch(() => Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 }))
    await expect(createNotifierFactory(fetcher)("telegram", { chatId: "1" }, "t").send(message)).rejects.toThrow("chat not found")
  })
})

describe("generic webhook", () => {
  test("posts report.created JSON with the page URL, signed when a secret is set", async () => {
    const { fetcher, requests } = fakeFetch()
    await createNotifierFactory(fetcher)("webhook", { url: "https://hooks.kantor.test/bugs" }, "s3cret").send(message)
    const request = requests[0] as Request
    const body = await request.text()
    expect(request.headers.get("x-bugberry-event")).toBe("report.created")
    expect(request.headers.get("x-bugberry-signature")).toBe(`sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`)
    const json = JSON.parse(body) as { event: string; report: { pageUrl: string; number: number; url: string } }
    expect(json.event).toBe("report.created")
    expect(json.report).toMatchObject({ number: 42, pageUrl: message.pageUrl, url: message.reportUrl })
  })

  test("no secret, no signature", async () => {
    const { fetcher, requests } = fakeFetch()
    await createNotifierFactory(fetcher)("webhook", { url: "https://hooks.kantor.test/bugs" }, "").send(message)
    expect((requests[0] as Request).headers.has("x-bugberry-signature")).toBe(false)
  })
})

describe("text from the report stays text", () => {
  test("markup in a title is escaped for each channel", async () => {
    const tricky = { ...message, title: "<b>Pay</b> & *now* _x_ [a](b) @here <!channel>" }
    const slack = fakeFetch()
    await createNotifierFactory(slack.fetcher)("slack", {}, "https://hooks.slack.com/services/x").send(tricky)
    const slackBody = await (slack.requests[0] as Request).text()
    expect(slackBody).toContain("&lt;b&gt;Pay&lt;/b&gt; &amp;")
    expect(slackBody).not.toContain("<!channel>")
    const discord = fakeFetch(() => new Response(null, { status: 204 }))
    await createNotifierFactory(discord.fetcher)("discord", {}, "https://discord.com/api/webhooks/1/a").send({
      ...tricky,
      reporterName: "[Session expired, sign in again](https://evil.example)",
    })
    const embed = ((await (discord.requests[0] as Request).json()) as { embeds: Array<{ title: string; fields: Array<{ value: string }> }> })
      .embeds[0]
    expect(embed?.title).toContain("\\*now\\* \\_x\\_ \\[a\\]\\(b\\)")
    expect(embed?.title.startsWith("BB-42 · ")).toBe(true)
    expect(embed?.fields.map((field) => field.value)).toContain("\\[Session expired, sign in again\\]\\(https://evil.example\\)")
    const telegram = fakeFetch(() => Response.json({ ok: true }))
    await createNotifierFactory(telegram.fetcher)("telegram", { chatId: "1" }, "t").send(tricky)
    const telegramText = ((await (telegram.requests[0] as Request).json()) as { text: string }).text
    expect(telegramText).toContain("&lt;b&gt;Pay&lt;/b&gt; &amp;")
  })
})
