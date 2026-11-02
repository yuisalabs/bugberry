import { describe, expect, test } from "bun:test"
import { locatorFor, parseTargetLabel } from "../src/mcp/repro"

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
