import { describe, expect, test } from "bun:test"
import { captureRunning, reinjectCapture } from "../../lib/capture/open-tabs"

describe("reinjectCapture", () => {
  const tabs = [
    { id: 1, url: "https://shop.test/cart" },
    { id: 2, url: "chrome://extensions/" },
    { id: 3, url: "http://localhost:4700/" },
    { id: 4 },
    { url: "https://no-id.test/" },
  ]

  test("adds the capture scripts to every open web page, and nowhere else", async () => {
    const injected: number[] = []
    await reinjectCapture({ tabs: async () => tabs, inject: async (tabId) => void injected.push(tabId) })
    expect(injected).toEqual([1, 3])
  })

  test("a tab it can't reach doesn't keep it from the others", async () => {
    const injected: number[] = []
    const inject = async (tabId: number) => {
      if (tabId === 1) throw new Error("Cannot access contents of the page")
      injected.push(tabId)
    }
    await reinjectCapture({ tabs: async () => tabs, inject })
    expect(injected).toEqual([3])
  })
})

describe("captureRunning", () => {
  const key = Symbol.for("bugberry.capture.session")

  test("true once the capture script has started a session in the page", () => {
    ;(globalThis as Record<symbol, unknown>)[key] = { snapshot: () => [] }
    try {
      expect(captureRunning()).toBe(true)
    } finally {
      delete (globalThis as Record<symbol, unknown>)[key]
    }
  })

  test("false in a page loaded before the extension", () => {
    expect(captureRunning()).toBe(false)
  })
})
