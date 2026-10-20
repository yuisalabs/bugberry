import { describe, expect, test } from "bun:test"
import { hasTabRecorder } from "../lib/browser-support"

describe("hasTabRecorder", () => {
  test("only when both tab capture and offscreen documents exist", () => {
    expect(hasTabRecorder({ offscreen: { createDocument() {} }, tabCapture: { getMediaStreamId() {} } })).toBe(true)
    expect(hasTabRecorder({})).toBe(false)
    expect(hasTabRecorder({ tabCapture: { getMediaStreamId() {} } })).toBe(false)
    expect(hasTabRecorder({ offscreen: { createDocument() {} } })).toBe(false)
  })
})
