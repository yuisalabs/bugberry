import { describe, expect, test } from "bun:test"
import { BRIDGE_HELLO, BRIDGE_OPEN_POPUP, BRIDGE_POPUP, BRIDGE_STATUS, BRIDGE_USE_SERVER } from "@bugberry/shared"
import { askExtension, type BridgeWindow, openExtensionPopup, useServerInExtension } from "../src/features/onboarding/extension-bridge"

function fakeWindow() {
  const listeners = new Set<(event: MessageEvent) => void>()
  const posted: Array<{ message: unknown; targetOrigin: string }> = []
  const target: BridgeWindow = {
    location: { origin: "https://bugberry.kantor.com" },
    postMessage: (message, targetOrigin) => void posted.push({ message, targetOrigin }),
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  }
  const deliver = (data: unknown, source: unknown = target) => {
    for (const listener of [...listeners]) listener({ data, source } as MessageEvent)
  }
  return { target, posted, deliver, listeners }
}

describe("openExtensionPopup", () => {
  test("asks the extension to open its popup and reads whether it did", async () => {
    const page = fakeWindow()
    const opened = openExtensionPopup(page.target, 50)
    expect(page.posted).toEqual([{ message: { type: BRIDGE_OPEN_POPUP }, targetOrigin: "https://bugberry.kantor.com" }])
    page.deliver({ type: BRIDGE_POPUP, opened: true }, {})
    page.deliver({ type: BRIDGE_POPUP, opened: true })
    expect(await opened).toBe(true)
    expect(page.listeners.size).toBe(0)
  })

  test("no answer in time means it did not open", async () => {
    expect(await openExtensionPopup(fakeWindow().target, 20)).toBe(false)
  })
})

describe("askExtension", () => {
  test("says hello to the page's own origin and reads the extension's answer", async () => {
    const page = fakeWindow()
    const answer = askExtension(page.target, 50)
    expect(page.posted).toEqual([{ message: { type: BRIDGE_HELLO }, targetOrigin: "https://bugberry.kantor.com" }])
    page.deliver({ type: BRIDGE_STATUS, active: false, version: "3.8.1" })
    expect(await answer).toEqual({ installed: true, active: false, version: "3.8.1" })
    expect(page.listeners.size).toBe(0)
  })

  test("no answer means no extension", async () => {
    const page = fakeWindow()
    expect(await askExtension(page.target, 10)).toEqual({ installed: false })
    expect(page.listeners.size).toBe(0)
  })

  test("messages from another window or of another shape are ignored", async () => {
    const page = fakeWindow()
    const answer = askExtension(page.target, 20)
    page.deliver({ type: BRIDGE_STATUS, active: true }, {})
    page.deliver({ type: BRIDGE_STATUS, active: "yes" })
    page.deliver({ type: BRIDGE_HELLO })
    expect(await answer).toEqual({ installed: false })
  })
})

describe("useServerInExtension", () => {
  test("asks the extension to switch, to the page's own origin", () => {
    const page = fakeWindow()
    useServerInExtension(page.target)
    expect(page.posted).toEqual([{ message: { type: BRIDGE_USE_SERVER }, targetOrigin: "https://bugberry.kantor.com" }])
  })
})
