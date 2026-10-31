import { describe, expect, test } from "bun:test"
import { type BugBerryGlobal, GLOBAL_KEY, QUEUE_MAX, sdkGlobal } from "../src/global"
import { createBugBerry } from "../src/index"

const stack = () => "Error\n    at log (https://shop.test/vendor.js:1:1)\n    at pay (https://shop.test/checkout.js:40:3)"
const globalOf = (host: object) => (host as Record<string, BugBerryGlobal>)[GLOBAL_KEY]!

describe("bugberry without the extension", () => {
  test("log queues an entry with its time, level, message, data and the app's stack", () => {
    const host = {}
    const sdk = createBugBerry(host, stack)
    sdk.log("Checkout started", { orderId: 8812 })
    sdk.error("Payment declined")
    const { queue } = globalOf(host)
    expect(queue).toHaveLength(2)
    expect(queue[0]).toMatchObject({ level: "info", message: "Checkout started", data: { orderId: 8812 } })
    expect(queue[0]?.stack).toBe("Error\n    at pay (https://shop.test/checkout.js:40:3)")
    expect(typeof queue[0]?.t).toBe("number")
    expect(queue[1]).toMatchObject({ level: "error", message: "Payment declined" })
    expect("data" in (queue[1] ?? {})).toBe(false)
  })

  test("log and info are level info; warn and error are themselves", () => {
    const host = {}
    const sdk = createBugBerry(host, stack)
    sdk.log("a"); sdk.info("b"); sdk.warn("c"); sdk.error("d")
    expect(globalOf(host).queue.map((entry) => entry.level)).toEqual(["info", "info", "warn", "error"])
  })

  test("the queue keeps the newest 50", () => {
    const host = {}
    const sdk = createBugBerry(host, stack)
    for (let n = 0; n < QUEUE_MAX + 5; n++) sdk.log(`line ${n}`)
    const messages = globalOf(host).queue.map((entry) => entry.message)
    expect(messages).toHaveLength(QUEUE_MAX)
    expect(messages[0]).toBe("line 5")
    expect(messages.at(-1)).toBe(`line ${QUEUE_MAX + 4}`)
  })

  test("the last metadata callback wins", () => {
    const host = {}
    const sdk = createBugBerry(host, stack)
    const first = () => ({ a: 1 })
    const second = () => ({ b: 2 })
    sdk.metadata(first)
    sdk.metadata(second)
    expect(globalOf(host).metadata).toBe(second)
  })

  test("two copies of the SDK share one global", () => {
    const host = {}
    createBugBerry(host, stack).log("from shell")
    createBugBerry(host, stack).log("from child")
    expect(globalOf(host).queue.map((entry) => entry.message)).toEqual(["from shell", "from child"])
  })

  test("a non-string message is coerced; undefined becomes \"undefined\"", () => {
    const host = {}
    const sdk = createBugBerry(host, stack)
    sdk.log(undefined as unknown as string)
    sdk.log({ toString: () => "obj" } as unknown as string)
    expect(globalOf(host).queue.map((entry) => entry.message)).toEqual(["undefined", "obj"])
  })
})

describe("bugberry never throws", () => {
  test("without a host", () => {
    const sdk = createBugBerry(undefined, stack)
    expect(() => { sdk.log("x"); sdk.metadata(() => ({})) }).not.toThrow()
  })
  test("on a frozen host", () => {
    const sdk = createBugBerry(Object.freeze({}), stack)
    expect(() => sdk.log("x")).not.toThrow()
  })
  test("when the stack reader throws", () => {
    const host = {}
    const sdk = createBugBerry(host, () => { throw new Error("no stack") })
    expect(() => sdk.log("x")).not.toThrow()
    expect(globalOf(host).queue[0]?.stack).toBeUndefined()
  })
  test("when a page replaced push with something that throws", () => {
    const host = {}
    sdkGlobal(host)!.push = () => { throw new Error("hostile") }
    expect(() => createBugBerry(host, stack).log("x")).not.toThrow()
  })
})

test("the exported bugberry binds to globalThis", async () => {
  const { bugberry } = await import("../src/index")
  bugberry.log("hello")
  expect(globalOf(globalThis).queue.at(-1)?.message).toBe("hello")
})

test("with the real stack reader, the first frame left is the app's call", () => {
  const host = {}
  const sdk = createBugBerry(host)
  function checkoutPage() {
    sdk.warn("from the app")
  }
  checkoutPage()
  const frames = (globalOf(host).queue[0]?.stack ?? "").split("\n").filter((line) => /:\d+:\d+\)?$/.test(line.trim()))
  expect(frames[0]).toContain("checkoutPage")
  expect(frames[0]).toContain("sdk.test.ts")
})
