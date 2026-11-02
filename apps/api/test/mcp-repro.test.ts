import { describe, expect, test } from "bun:test"
import { normalizePayload } from "@bugberry/debugger-view"
import { locatorFor, parseTargetLabel, reproductionScript, scriptFilename } from "../src/mcp/repro"
import { samplePayload } from "./mcp-helpers"

describe("parseTargetLabel", () => {
  test("tag, id, classes, attribute and text", () => {
    expect(parseTargetLabel('button#buy.btn.primary[data-testid="pay"] "Pay now"')).toEqual({
      tag: "button",
      id: "buy",
      classes: ["btn", "primary"],
      testId: "pay",
      name: null,
      text: "Pay now",
      truncated: false,
    })
    expect(parseTargetLabel('input[name="email"]')).toMatchObject({ tag: "input", name: "email", text: null })
    expect(parseTargetLabel('a "Read more…"')).toMatchObject({ text: "Read more", truncated: true })
    expect(parseTargetLabel("div.card")).toMatchObject({ tag: "div", classes: ["card"], text: null })
  })

  test("a value with a space, dot or quote is not guessed at", () => {
    expect(parseTargetLabel('div#a b "x"')).toBeNull()
    expect(parseTargetLabel('button "Say "hi" now"')).toBeNull()
    expect(parseTargetLabel("")).toBeNull()
  })
})

describe("locatorFor", () => {
  test("first match wins: testid, id, name, role text, text, tag", () => {
    expect(locatorFor('button#buy[data-testid="pay"] "Pay"')).toEqual({ code: 'page.getByTestId("pay")', todo: null })
    expect(locatorFor('button#buy "Pay"')).toEqual({ code: 'page.locator("#buy")', todo: null })
    expect(locatorFor('input[name="email"]')).toEqual({ code: `page.locator('input[name="email"]')`, todo: null })
    expect(locatorFor('button "Pay now"')).toEqual({ code: 'page.getByRole("button", { name: "Pay now" })', todo: null })
    expect(locatorFor('a "Terms"')).toEqual({ code: 'page.getByRole("link", { name: "Terms" })', todo: null })
    expect(locatorFor('span "Total"')).toEqual({ code: 'page.getByText("Total", { exact: true })', todo: null })
  })

  test("truncated text is a prefix match", () => {
    expect(locatorFor('button "Continue to pay…"')?.code).toBe('page.getByRole("button", { name: /^Continue to pay/ })')
    expect(locatorFor('p "Lorem (ipsum)…"')?.code).toBe('page.getByText("Lorem (ipsum)", { exact: false })')
  })

  test("tag and classes only carries a TODO", () => {
    expect(locatorFor("div.card.big")).toEqual({
      code: 'page.locator("div.card.big")',
      todo: "check this locator, it may match several elements",
    })
    expect(locatorFor("div")?.todo).toBe("check this locator, it may match several elements")
  })

  test("strings are escaped for TypeScript and regexes", () => {
    expect(locatorFor('button "It\'s $5"')?.code).toBe(`page.getByRole("button", { name: "It's $5" })`)
    expect(locatorFor('button "A (b)…"')?.code).toBe('page.getByRole("button", { name: /^A \\(b\\)/ })')
    expect(locatorFor("div#a b")).toBeNull()
  })

  test("an id that isn't a plain CSS name is matched by attribute", () => {
    expect(locatorFor('div#1st "x"')?.code).toBe('page.locator("[id=\\"1st\\"]")')
    expect(locatorFor("input[name=\"it's\"]")?.code).toBe(`page.locator('input[name="it\\'s"]')`)
  })
})

const meta = { number: 7, title: "Pay fails", url: "https://bb.test/app/r/r1", pageUrl: "https://shop.test/checkout", captureType: "screenshot" as const }
const view = (events: unknown[]) => normalizePayload({ events, capturedAt: 1_000_000 })
const body = (script: string) => script.split("async ({ page }) => {")[1] ?? ""
const bodyLines = (script: string | undefined) =>
  body(script ?? "")
    .split("\n")
    .map((line) => line.trim())

describe("scriptFilename", () => {
  test("slug from the title, cut to 40", () => {
    expect(scriptFilename(7, "Pay fails!")).toBe("bb-7-pay-fails.spec.ts")
    expect(scriptFilename(7, "–––")).toBe("bb-7.spec.ts")
    expect(scriptFilename(7, "a".repeat(60))).toBe(`bb-7-${"a".repeat(40)}.spec.ts`)
  })
})

describe("reproductionScript", () => {
  test("null without actions", () => {
    expect(reproductionScript(view([{ kind: "console", t: 1, level: "error", args: ["x"] }]), meta)).toBeNull()
  })

  test("the sample checkout: start, masked fill, click, rage click, navigation, two error and one request assertion", () => {
    const result = reproductionScript(normalizePayload(samplePayload()), { ...meta, captureType: "video" })
    expect(result?.filename).toBe("bb-7-pay-fails.spec.ts")
    const script = result?.script ?? ""
    expect(script.startsWith('// Save as bb-7-pay-fails.spec.ts\n// Reproduces BB-7 "Pay fails" – https://bb.test/app/r/r1\n')).toBe(true)
    expect(script).toContain('import { test, expect } from "@playwright/test"')
    expect(script).toContain('test("BB-7: Pay fails", async ({ page }) => {')
    const lines = bodyLines(script)
    expect(lines).toContain('await page.goto("https://shop.test/checkout")')
    expect(lines).toContain('await page.locator("#email").fill("TODO") // typed 6 characters')
    expect(lines).toContain('await page.getByRole("button", { name: "Pay now" }).click()')
    expect(lines).toContain('await page.getByRole("button", { name: "Pay now" }).click({ clickCount: 3 }) // rage click: pressed 3 times')
    expect(lines).toContain(String.raw`await expect(page).toHaveURL(/^https:\/\/shop\.test\/cart(?:[?#].*)?$/)`)
    expect(lines).toContain('expect(errors.filter((text) => text.includes("Order failed"))).toEqual([])')
    expect(lines).toContain('expect(errors.filter((text) => text.includes("TypeError: x is undefined"))).toEqual([])')
    expect(lines).toContain("// In the report: POST /api/orders → 500")
    expect(lines).toContain('expect(failed.filter((line) => line.startsWith("POST /api/orders "))).toEqual([])')
    expect(script).not.toContain("••")
    expect(result?.warnings).toEqual([
      "Fill in the 1 value(s) marked TODO: BugBerry never stores what people type.",
      "This page may need a signed-in user: add your login setup (storageState) if it does.",
      "Steps from other tabs, or from before the capture's buffer started, may be missing.",
    ])
    for (const warning of result?.warnings ?? []) expect(script).toContain(`//  - ${warning}`)
  })

  test("navigation kinds", () => {
    const result = reproductionScript(
      view([
        { kind: "action", t: 1, type: "navigate", url: "https://a.test/one", via: "load" },
        { kind: "action", t: 2, type: "navigate", url: "https://a.test/two", via: "reload" },
        { kind: "action", t: 3, type: "navigate", url: "https://a.test/one", via: "back-forward" },
        { kind: "action", t: 4, type: "navigate", url: "https://a.test/three?x=1" },
        { kind: "action", t: 5, type: "click", target: 'button "Go"' },
        { kind: "action", t: 6, type: "navigate", url: "https://a.test/four", via: "load" },
        { kind: "action", t: 7, type: "navigate", url: "https://a.test/five", via: "load" },
      ]),
      meta,
    )
    const lines = bodyLines(result?.script)
    expect(lines).toContain('await page.goto("https://a.test/one")')
    expect(lines).toContain("await page.reload()")
    expect(lines).toContain("await page.goBack() // or goForward(): the capture doesn't say which")
    expect(lines).toContain(String.raw`await expect(page).toHaveURL(/^https:\/\/a\.test\/three(?:[?#].*)?$/)`)
    expect(lines).toContain(String.raw`await expect(page).toHaveURL(/^https:\/\/a\.test\/four(?:[?#].*)?$/)`)
    expect(lines).toContain('await page.goto("https://a.test/five")')
    // The start navigation is the goto and nothing else; goBack carries no URL.
    expect(lines.filter((line) => line.includes("/one"))).toHaveLength(1)
  })

  test("a redacted URL is opened with a note to put the value back", () => {
    const result = reproductionScript(
      view([
        { kind: "page", t: 1, url: "https://a.test/reset?token=[redacted]", via: "load" },
        { kind: "action", t: 2, type: "click", target: 'button "Go"' },
      ]),
      meta,
    )
    expect(bodyLines(result?.script)).toContain(
      'await page.goto("https://a.test/reset?token=[redacted]") // TODO: BugBerry redacted a value in this URL, put the real one back',
    )
  })

  test("the page event sets the start and inputs collapse", () => {
    const result = reproductionScript(
      view([
        { kind: "page", t: 1, url: "https://a.test/form", via: "load" },
        { kind: "action", t: 2, type: "input", target: 'input[name="q"]', value: "•" },
        { kind: "action", t: 3, type: "input", target: 'input[name="q"]', value: "•".repeat(50) },
        { kind: "action", t: 4, type: "input", target: "input#agree", value: "checked" },
        { kind: "action", t: 5, type: "input", target: "input#news", value: "unchecked" },
        { kind: "action", t: 6, type: "input", target: "input#card" },
        { kind: "action", t: 7, type: "submit", target: "form#checkout" },
        { kind: "action", t: 8, type: "scroll", value: "0,300" },
        { kind: "action", t: 9, type: "visibility", value: "hidden" },
      ]),
      meta,
    )
    const lines = bodyLines(result?.script)
    expect(lines).toContain('await page.goto("https://a.test/form")')
    expect(lines.filter((line) => line.includes('[name="q"]'))).toEqual([`await page.locator('input[name="q"]').fill("TODO") // typed 50+ characters`])
    expect(lines).toContain('await page.locator("#agree").check()')
    expect(lines).toContain('await page.locator("#news").uncheck()')
    expect(lines).toContain('await page.locator("#card").fill("TODO") // value hidden by data-bugberry-mask')
    expect(lines).toContain("// form submitted: form#checkout")
    expect(result?.script).not.toMatch(/scroll|visibility/i)
    expect(result?.warnings[0]).toBe("Fill in the 2 value(s) marked TODO: BugBerry never stores what people type.")
  })

  test("unreadable labels, TODO locators and the no-assertion fallback", () => {
    const result = reproductionScript(
      view([
        { kind: "action", t: 1, type: "click", target: 'div#a b "x"' },
        { kind: "action", t: 2, type: "click", target: "div.card" },
      ]),
      meta,
    )
    const lines = bodyLines(result?.script)
    expect(lines).toContain('// TODO: step skipped, BugBerry could not read this element: div#a b "x"')
    expect(lines).toContain('await page.locator("div.card").click() // TODO: check this locator, it may match several elements')
    expect(result?.script).toContain("// TODO: no errors or failed requests were captured.")
    expect(result?.warnings).toEqual([
      "This page may need a signed-in user: add your login setup (storageState) if it does.",
      "Check the 1 locator(s) marked TODO: they may match several elements.",
      "1 step(s) were skipped because their element label could not be read.",
    ])
  })

  test("assertions: same origin only, unparseable URLs skipped, SDK errors counted in a warning, caps of 5", () => {
    const errors = Array.from({ length: 7 }, (_, n) => ({ kind: "error", t: 10 + n, message: `E${n}\nat x` }))
    const result = reproductionScript(
      view([
        { kind: "page", t: 1, url: "https://a.test/", via: "load" },
        { kind: "action", t: 2, type: "click", target: 'button "Go"' },
        { kind: "network", t: 3, method: "GET", url: "https://cdn.other/x.js", status: 500 },
        { kind: "network", t: 4, method: "POST", url: "not a url", status: 500 },
        { kind: "network", t: 5, method: "POST", url: "https://a.test/api/a", failed: "net::ERR" },
        { kind: "network", t: 6, method: "POST", url: "https://a.test/api/a", status: 502 },
        { kind: "network", t: 7, method: "GET", url: "https://a.test/api/b?x=1", status: 404 },
        { kind: "sdk", t: 8, level: "error", message: "checkout failed" },
        { kind: "error", t: 9, message: "E0\nat y" },
        ...errors,
      ]),
      meta,
    )
    const lines = bodyLines(result?.script)
    expect(lines.filter((line) => line.startsWith("expect(failed"))).toEqual([
      'expect(failed.filter((line) => line.startsWith("POST /api/a "))).toEqual([])',
      'expect(failed.filter((line) => line.startsWith("GET /api/b "))).toEqual([])',
    ])
    expect(lines).toContain("// In the report: POST /api/a → failed")
    expect(lines.filter((line) => line.startsWith("expect(errors"))).toHaveLength(5)
    expect(lines[lines.findIndex((line) => line.startsWith("expect(errors"))]).toContain('"E0"')
    expect(result?.script).not.toContain("checkout failed")
    expect(result?.warnings).toContain(
      'The report has 1 error-level SDK log line(s) (bugberry.error) that this script does not check. See getConsoleLogs sources=["sdk"].',
    )
  })
})
