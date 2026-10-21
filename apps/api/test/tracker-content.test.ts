import { describe, expect, test } from "bun:test"
import { buildIssueContent, renderAtlassianDocument, renderHtml, renderMarkdown } from "../src/lib/trackers/content"
import { gunzipLimited, topErrors } from "../src/lib/trackers/debugger-errors"

const HOSTILE_TITLE = "@octocat [x](https://evil.test) ![i](https://evil.test/p.png) a`b"
const report = {
  id: "r1",
  title: "Pay button fails",
  description: "Clicking Pay does nothing.\nTry it in Chrome.",
  pageUrl: "https://app.kantor.test/checkout?step=2",
  pageTitle: HOSTILE_TITLE,
  captureType: "screenshot" as const,
  device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
  debuggerSummary: { logs: 4, errors: 2, requests: 6, failedRequests: 1, actions: 3, incomplete: [] },
}

describe("topErrors", () => {
  test("takes the first distinct page errors and console errors, cut to length", () => {
    const events = [
      { kind: "console", t: 1, level: "log", args: ["ignored"] },
      { kind: "error", t: 2, message: "TypeError: x is undefined" },
      { kind: "console", t: 3, level: "error", args: ["checkout", "failed"] },
      { kind: "error", t: 4, message: "TypeError: x is undefined" },
      { kind: "error", t: 5, message: "y".repeat(800) },
      { kind: "error", t: 6, message: "fourth" },
      { kind: "error", t: 7, message: 42 },
    ]
    const errors = topErrors(events)
    expect(errors.slice(0, 2)).toEqual(["TypeError: x is undefined", "checkout failed"])
    expect(errors).toHaveLength(3)
    expect(errors[2]?.length).toBeLessThanOrEqual(501)
  })
})

describe("gunzipLimited", () => {
  test("decompresses small payloads and refuses oversized ones", async () => {
    const blob = new Blob([Bun.gzipSync(JSON.stringify({ a: "x".repeat(2000) }))])
    expect(JSON.parse(await gunzipLimited(blob)).a).toHaveLength(2000)
    await expect(gunzipLimited(blob, 100)).rejects.toThrow(/too large/)
  })
})

describe("issue content", () => {
  const content = buildIssueContent(report, ["Error: boom ``` ![x](https://evil.test)", "<script>alert(1)</script>"], "https://bugberry.kantor.test")

  test("collects the summary facts and links back to BugBerry", () => {
    expect(content.reportUrl).toBe("https://bugberry.kantor.test/app/r/r1")
    expect(content.facts).toContainEqual(["Page", "https://app.kantor.test/checkout?step=2"])
    expect(content.facts).toContainEqual(["Console errors", "2"])
    expect(content.facts).toContainEqual(["Failed requests", "1"])
  })

  test("markdown keeps page data inert: no mentions, links or images", () => {
    const markdown = renderMarkdown(content)
    expect(markdown).toContain("Clicking Pay does nothing.")
    expect(markdown).toContain("`@octocat [x](https://evil.test) ![i](https://evil.test/p.png) ab`")
    expect(markdown).toContain("[Open the report in BugBerry](https://bugberry.kantor.test/app/r/r1)")
    // The error with a triple backtick sits inside a longer fence, so it cannot close the block early.
    expect(markdown).toContain("````\nError: boom ``` ![x](https://evil.test)\n````")
  })

  test("HTML escapes everything from the page", () => {
    const html = renderHtml(content)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("Clicking Pay does nothing.<br>Try it in Chrome.")
    expect(html).toContain('<a href="https://bugberry.kantor.test/app/r/r1">Open the report in BugBerry</a>')
  })
})

describe("a careless description", () => {
  test("cannot open a block that turns page data into live markdown", () => {
    const careless = { ...report, description: "Langkah:\n```\nklik bayar\n<!--" }
    const markdown = renderMarkdown(buildIssueContent(careless, ["```\n@octocat ![i](https://evil.test/p.png)"], "https://bugberry.kantor.test"))
    const [descriptionPart] = markdown.split("\n\n**Summary**")
    // Every description line sits inside a blockquote, so any block it opens ends with the quote.
    expect(descriptionPart?.split("\n")).toEqual(["> Langkah:", "> ```", "> klik bayar", "> <!--"])
    expect(markdown).toContain("````\n```\n@octocat ![i](https://evil.test/p.png)\n````")
  })
})

describe("Atlassian document", () => {
  test("keeps page text as text, never markup", () => {
    const doc = renderAtlassianDocument({
      title: "<b>Pay</b> *now*",
      description: "Clicked *Pay* <script>x</script>",
      facts: [["Page", "https://shop.test/?q=<b>"]],
      errors: ["TypeError: x is undefined"],
      reportUrl: "https://bugberry.kantor.test/app/r/r1",
    }) as { version: number; type: string; content: unknown[] }
    expect(doc).toMatchObject({ version: 1, type: "doc" })
    const json = JSON.stringify(doc)
    expect(json).toContain("Clicked *Pay* <script>x</script>")
    expect(json).toContain("https://shop.test/?q=<b>")
    expect(json).toContain('"type":"codeBlock"')
    expect(json).toContain('"href":"https://bugberry.kantor.test/app/r/r1"')
  })
})
