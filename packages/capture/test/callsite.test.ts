import { describe, expect, test } from "bun:test"
import { callSite, createStackBudget } from "../src/callsite"

const STACK = [
  "Error",
  "    at Object.log (chrome-extension://abcdefghijklmnop/content-scripts/capture.js:1:200)",
  "    at pay (https://shop.test/js/checkout.js?v=3:88:12)",
  "    at https://shop.test/js/app.js:5:1",
].join("\n")

describe("callSite", () => {
  test("names the first page frame as file:line, skipping the extension's own frames", () => {
    expect(callSite(STACK)).toBe("checkout.js:88")
  })

  test("an anonymous frame on the page's root names the host", () => {
    expect(callSite("Error\n    at https://shop.test/:12:5")).toBe("shop.test:12")
  })

  test("nothing from the page, or no stack, gives nothing", () => {
    expect(callSite("Error\n    at x (chrome-extension://abc/capture.js:1:1)")).toBeUndefined()
    expect(callSite(undefined)).toBeUndefined()
    expect(callSite("Error\n    at <anonymous>")).toBeUndefined()
  })
})

describe("createStackBudget", () => {
  test("a page that logs in a tight loop pays for at most the budget per second", () => {
    let now = 1000
    let built = 0
    const stackOf = createStackBudget(() => {
      built += 1
      return "Error"
    }, () => now, 100)
    for (let index = 0; index < 1000; index++) stackOf()
    expect(built).toBe(100)
    expect(stackOf()).toBeUndefined()
    now += 1000
    expect(stackOf()).toBe("Error")
  })

  test("a stack that is not a string gives no call site", () => {
    expect(callSite({ frames: [] } as unknown as string)).toBeUndefined()
  })
})
