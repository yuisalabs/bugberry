import { describe, expect, test } from "bun:test"
import { BRIDGE_HELLO, BRIDGE_STATUS, BRIDGE_USE_SERVER, EXTENSION_ID_PATTERN } from "../src"

describe("extension constants", () => {
  test("EXTENSION_ID_PATTERN accepts Chrome extension IDs only", () => {
    const pattern = new RegExp(EXTENSION_ID_PATTERN)
    expect(pattern.test("abcdefghijklmnopabcdefghijklmnop")).toBe(true)
    expect(pattern.test("abcdefghijklmnopabcdefghijklmnoq")).toBe(false)
    expect(pattern.test("ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP")).toBe(false)
    expect(pattern.test("abc")).toBe(false)
  })

  test("dashboard bridge message types", () => {
    expect(BRIDGE_HELLO).toBe("bugberry:hello")
    expect(BRIDGE_STATUS).toBe("bugberry:status")
    expect(BRIDGE_USE_SERVER).toBe("bugberry:use-server")
  })
})
