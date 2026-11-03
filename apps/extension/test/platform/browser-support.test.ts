import { describe, expect, test } from "bun:test"
import { hasTabRecorder, shortcutsPage } from "../../lib/platform/browser-support"

describe("hasTabRecorder", () => {
  test("only when both tab capture and offscreen documents exist", () => {
    expect(hasTabRecorder({ offscreen: { createDocument() {} }, tabCapture: { getMediaStreamId() {} } })).toBe(true)
    expect(hasTabRecorder({})).toBe(false)
    expect(hasTabRecorder({ tabCapture: { getMediaStreamId() {} } })).toBe(false)
    expect(hasTabRecorder({ offscreen: { createDocument() {} } })).toBe(false)
  })
})

describe("shortcutsPage", () => {
  test("each Chromium browser has its own page for extension shortcuts", () => {
    expect(shortcutsPage("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36")).toBe("chrome://extensions/shortcuts")
    expect(shortcutsPage("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0")).toBe("opera://extensions/shortcuts")
    expect(shortcutsPage("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0")).toBe("edge://extensions/shortcuts")
  })
})
