import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { createEventBuffer } from "../src/buffer"
import type { ActionEvent, CaptureEvent } from "../src/events"
import { type ActionHost, installActionHooks } from "../src/hooks/actions"

let win: Window
let doc: Document
let clock: number
let events: CaptureEvent[]
let uninstall: () => void

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const actions = () => events.filter((event): event is ActionEvent => event.kind === "action")
const byId = (id: string) => doc.getElementById(id) as HTMLElement

function type(id: string, text: string) {
  const input = byId(id) as HTMLInputElement
  for (const char of text) {
    input.value += char
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event)
  }
  input.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event)
}

beforeEach(() => {
  win = new Window({ url: "https://app.kantor.test/start?session_token=abc" })
  doc = win.document as unknown as Document
  doc.body.innerHTML = `
    <button id="buy" class="btn">Buy now</button>
    <input id="name" name="fullName">
    <input id="pw" type="password">
    <div data-bugberry-mask><input id="card"><button id="reveal">4111 1111</button></div>
    <input id="agree" type="checkbox">
    <form id="checkout"><button id="submit">Pay</button></form>
  `
  clock = 10_000
  events = []
  uninstall = installActionHooks(win as unknown as ActionHost, (event) => events.push(event), () => clock)
})

afterEach(async () => {
  uninstall()
  await win.happyDOM.close()
})

describe("installActionHooks", () => {
  test("records the starting page with secrets removed from the URL", () => {
    expect(actions()[0]).toMatchObject({ type: "navigate", t: 10_000 })
    expect(actions()[0]?.url).not.toContain("abc")
  })

  test("records clicks, even when the page stops propagation", () => {
    byId("buy").addEventListener("click", (event) => event.stopPropagation())
    byId("buy").click()
    expect(actions().at(-1)).toMatchObject({ type: "click", target: 'button#buy.btn "Buy now"' })
  })

  test("a typing burst becomes one input event with a masked value", () => {
    type("name", "Ana Lestari")
    const inputs = actions().filter((event) => event.type === "input")
    expect(inputs).toEqual([
      { kind: "action", t: 10_000, type: "input", target: 'input#name[name="fullName"]', value: "•".repeat(11) },
    ])
    expect(JSON.stringify(events)).not.toContain("Ana")
  })

  test("typing after the input event left the buffer records a new one instead of updating a lost event", () => {
    uninstall()
    const buffer = createEventBuffer({ maxEvents: 3, now: () => clock })
    uninstall = installActionHooks(win as unknown as ActionHost, (event) => buffer.push(event), () => clock, (event) =>
      buffer.has(event),
    )
    type("name", "An")
    for (let index = 0; index < 3; index++) buffer.push({ kind: "console", t: clock, level: "log", args: ["noise"] })
    clock += 1000
    type("name", "a")
    const inputs = buffer.snapshot().filter((event) => event.kind === "action" && event.type === "input")
    expect(inputs).toEqual([
      { kind: "action", t: 11_000, type: "input", target: 'input#name[name="fullName"]', value: "•••" },
    ])
  })

  test("passwords and masked areas never record a value or text", () => {
    type("pw", "hunter2")
    type("card", "4111111111111111")
    byId("reveal").click()
    const recorded = actions().filter((event) => event.type !== "navigate")
    expect(recorded.map((event) => event.value)).toEqual([undefined, undefined, undefined])
    expect(recorded.at(-1)?.target).toBe("button#reveal")
    expect(JSON.stringify(events)).not.toContain("4111")
    expect(JSON.stringify(events)).not.toContain("hunter2")
  })

  test("checkbox changes record their state", () => {
    const box = byId("agree") as HTMLInputElement
    box.checked = true
    box.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event)
    expect(actions().at(-1)).toMatchObject({ type: "input", value: "checked" })
  })

  test("form submissions are recorded", () => {
    const form = byId("checkout")
    form.addEventListener("submit", (event) => event.preventDefault())
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event)
    expect(actions().at(-1)).toMatchObject({ type: "submit", target: 'form#checkout "Pay"' })
  })

  test("SPA navigation through history and hash changes is recorded", async () => {
    win.history.pushState({}, "", "/cart?api_key=k")
    win.history.replaceState({}, "", "/cart/2")
    win.location.hash = "#summary"
    await flush()
    const urls = actions()
      .filter((event) => event.type === "navigate")
      .map((event) => event.url)
    expect(urls.slice(1)).toEqual([
      "https://app.kantor.test/cart?api_key=[redacted]",
      "https://app.kantor.test/cart/2",
      "https://app.kantor.test/cart/2#summary",
    ])
  })

  test("popstate and hashchange for the same move are recorded once", () => {
    win.history.pushState({}, "", "/a#x")
    // Going back to a hash entry fires both events for one URL change.
    win.dispatchEvent(new win.Event("popstate"))
    win.dispatchEvent(new win.Event("hashchange"))
    const urls = actions()
      .filter((event) => event.type === "navigate")
      .map((event) => event.url)
    expect(urls.slice(1)).toEqual(["https://app.kantor.test/a#x"])
  })

  test("a router rewriting the URL while scrolling leaves one navigation with the latest URL", () => {
    for (let offset = 1; offset <= 50; offset++) win.history.replaceState({}, "", `/feed?offset=${offset * 20}`)
    const navigations = actions().filter((event) => event.type === "navigate")
    expect(navigations.slice(1).map((event) => event.url)).toEqual(["https://app.kantor.test/feed?offset=1000"])
  })

  test("scrolling is recorded at most once per second", () => {
    const scroll = () => win.dispatchEvent(new win.Event("scroll"))
    scroll()
    clock += 400
    scroll()
    clock += 700
    scroll()
    expect(actions().filter((event) => event.type === "scroll")).toHaveLength(2)
  })

  test("uninstall leaves a history wrapper the page added later in place", () => {
    const ours = win.history.pushState
    const pageWrapper = function (this: History, ...args: Parameters<History["pushState"]>) {
      return Reflect.apply(ours, this, args)
    }
    win.history.pushState = pageWrapper
    uninstall()
    expect(win.history.pushState).toBe(pageWrapper)
  })

  test("uninstall stops recording and restores history", () => {
    const pushState = win.history.pushState
    uninstall()
    byId("buy").click()
    expect(actions().filter((event) => event.type === "click")).toHaveLength(0)
    expect(win.history.pushState).not.toBe(pushState)
  })
})

describe("how a navigation happened", () => {
  const withNavigation = (type: string) => {
    uninstall()
    events = []
    const host = Object.assign(win, { performance: { getEntriesByType: () => [{ type }] } })
    uninstall = installActionHooks(host as unknown as ActionHost, (event) => events.push(event), () => clock)
    return actions()[0]
  }

  test("the first navigation says the page was reloaded", () => {
    expect(withNavigation("reload")?.via).toBe("reload")
    expect(withNavigation("back_forward")?.via).toBe("back-forward")
    expect(withNavigation("navigate")?.via).toBe("load")
  })

  test("pushState navigations are via history and popstate via back-forward", () => {
    win.history.pushState({}, "", "/cart")
    win.history.pushState({}, "", "/pay")
    // Going back: the browser moves the URL, then fires popstate.
    win.happyDOM.setURL("https://app.kantor.test/cart")
    win.dispatchEvent(new win.Event("popstate"))
    win.happyDOM.setURL("https://app.kantor.test/cart#top")
    win.dispatchEvent(new win.Event("hashchange"))
    const navigations = actions()
      .filter((event) => event.type === "navigate")
      .slice(1)
    expect(navigations.map((event) => [event.url, event.via])).toEqual([
      ["https://app.kantor.test/cart", "history"],
      ["https://app.kantor.test/pay", "history"],
      ["https://app.kantor.test/cart", "back-forward"],
      ["https://app.kantor.test/cart#top", undefined],
    ])
  })
})

describe("frustration and attention", () => {
  const press = (id: string) => byId(id).dispatchEvent(new win.Event("pointerdown", { bubbles: true }) as unknown as Event)
  const rage = () => actions().filter((event) => event.type === "rage-click")

  test("three quick presses on one button make one rage click that keeps counting", () => {
    ;(byId("buy") as HTMLButtonElement).disabled = true
    for (let index = 0; index < 4; index++) {
      press("buy")
      clock += 200
    }
    expect(rage()).toHaveLength(1)
    expect(rage()[0]).toMatchObject({ type: "rage-click", value: "4", target: expect.stringContaining("button#buy") })
  })

  test("presses on different elements or a second apart are not rage", () => {
    press("buy")
    press("submit")
    press("buy")
    clock += 1500
    press("buy")
    clock += 1500
    press("buy")
    expect(rage()).toHaveLength(0)
  })

  test("hiding and showing the tab is recorded", () => {
    Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => "hidden" })
    doc.dispatchEvent(new win.Event("visibilitychange") as unknown as Event)
    Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => "visible" })
    doc.dispatchEvent(new win.Event("visibilitychange") as unknown as Event)
    expect(actions().filter((event) => event.type === "visibility").map((event) => event.value)).toEqual(["hidden", "visible"])
  })
})
