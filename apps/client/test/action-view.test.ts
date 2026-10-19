import { describe, expect, test } from "bun:test"
import type { ViewAction } from "../src/lib/debugger-events"
import { actionCounts, actionSentence, matchesActionFilter } from "../src/lib/action-view"

const action = (overrides: Partial<ViewAction>): ViewAction => ({
  kind: "action",
  t: 1000,
  type: "click",
  target: null,
  value: null,
  url: null,
  via: null,
  ...overrides,
})

describe("actionSentence", () => {
  test("says what the person did", () => {
    expect(actionSentence(action({ type: "click", target: "button#pay" }))).toMatchObject({ text: "Clicked button#pay", masked: false })
    expect(actionSentence(action({ type: "input", target: "input[name=email]", value: "dana@acme.io" }))).toMatchObject({
      text: "Typed into input[name=email] “dana@acme.io”",
      masked: false,
    })
    expect(actionSentence(action({ type: "submit", target: "form#checkout" })).text).toBe("Submitted form#checkout")
    expect(actionSentence(action({ type: "navigate", url: "https://shop.test/cart" })).text).toBe("Navigated to https://shop.test/cart")
    expect(actionSentence(action({ type: "scroll" })).text).toBe("Scrolled the page")
  })

  test("a masked value shows its dots and is marked", () => {
    expect(actionSentence(action({ type: "input", target: "input[name=card]", value: "••••••" }))).toMatchObject({
      text: "Typed into input[name=card] ••••••",
      masked: true,
    })
  })

  test("splits the target out for the monospace part", () => {
    expect(actionSentence(action({ type: "click", target: "button#pay" })).parts).toEqual({
      before: "Clicked",
      target: "button#pay",
      after: "",
    })
  })
})

describe("actionCounts", () => {
  test("counts all, clicks (rage included), inputs, navigations and tab changes", () => {
    const actions = [
      action({ type: "click" }),
      action({ type: "click" }),
      action({ type: "rage-click", value: "4" }),
      action({ type: "input" }),
      action({ type: "navigate" }),
      action({ type: "scroll" }),
      action({ type: "visibility", value: "hidden" }),
      action({ type: "visibility", value: "visible" }),
    ]
    expect(actionCounts(actions)).toEqual({ all: 8, clicks: 3, inputs: 1, navigation: 1, tab: 2 })
    expect(actions.filter((item) => matchesActionFilter(item, "clicks"))).toHaveLength(3)
    expect(actions.filter((item) => matchesActionFilter(item, "tab"))).toHaveLength(2)
    expect(actions.filter((item) => matchesActionFilter(item, "all"))).toHaveLength(8)
  })
})

describe("frustration, attention and scrolling", () => {
  test("a rage click is a frustration signal", () => {
    expect(actionSentence(action({ type: "rage-click", target: "button#pay", value: "4" }))).toMatchObject({
      text: "Rage click ×4 on button#pay",
      frustration: true,
    })
    expect(actionSentence(action({ type: "click", target: "a" })).frustration).toBe(false)
  })

  test("tab visibility and scroll position read as sentences", () => {
    expect(actionSentence(action({ type: "visibility", value: "hidden" })).text).toBe("Tab became hidden")
    expect(actionSentence(action({ type: "visibility", value: "visible" })).text).toBe("Tab became visible")
    expect(actionSentence(action({ type: "scroll", value: "0,640" })).text).toBe("Scrolled page to 640 px")
    expect(actionSentence(action({ type: "scroll", value: "junk" })).text).toBe("Scrolled the page")
  })

  test("a navigation says how it happened", () => {
    expect(actionSentence(action({ type: "navigate", url: "https://shop.test/", via: "reload" })).text).toBe(
      "Navigated to https://shop.test/ via a page reload",
    )
  })
})
