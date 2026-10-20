import { describe, expect, test } from "bun:test"
import { capturePrefsFrom, createCapturePrefsStorage, DEFAULT_CAPTURE_PREFS, recordOptionsFor } from "../lib/capture-prefs"

function memoryArea() {
  const items: Record<string, unknown> = {}
  return {
    items,
    get: async (key: string) => (key in items ? { [key]: items[key] } : {}),
    set: async (values: Record<string, unknown>) => void Object.assign(items, values),
  }
}

describe("capturePrefsFrom", () => {
  test("nothing stored gives the defaults", () => {
    expect(capturePrefsFrom(undefined)).toEqual({
      screenshotMode: "visible",
      recordSource: "tab",
      mic: false,
      systemAudio: true,
      countdown: true,
    })
  })

  test("each bad field falls back on its own", () => {
    expect(capturePrefsFrom({ screenshotMode: "full", recordSource: "window", mic: "yes" })).toEqual({
      screenshotMode: "visible",
      recordSource: "window",
      mic: false,
      systemAudio: true,
      countdown: true,
    })
  })
})

describe("capture prefs storage", () => {
  test("a change keeps the other choices", async () => {
    const area = memoryArea()
    const prefs = createCapturePrefsStorage(area)
    expect(await prefs.set({ mic: true })).toMatchObject({ mic: true, recordSource: "tab" })
    await prefs.set({ recordSource: "screen" })
    expect(await prefs.get()).toEqual({ screenshotMode: "visible", recordSource: "screen", mic: true, systemAudio: true, countdown: true })
    expect(Object.keys(area.items)).toEqual(["capturePrefs"])
  })
})

describe("recordOptionsFor", () => {
  test("without a tab recorder, tab becomes window and system audio is off", () => {
    expect(recordOptionsFor({ ...DEFAULT_CAPTURE_PREFS, recordSource: "tab", systemAudio: true }, false)).toEqual({
      source: "window",
      mic: false,
      systemAudio: false,
      countdown: true,
    })
    expect(recordOptionsFor({ ...DEFAULT_CAPTURE_PREFS, recordSource: "screen", systemAudio: true }, false)).toMatchObject({
      source: "screen",
      systemAudio: false,
    })
  })

  test("with a tab recorder the choices pass through unchanged", () => {
    expect(recordOptionsFor({ ...DEFAULT_CAPTURE_PREFS, recordSource: "screen", systemAudio: true, mic: true }, true)).toEqual({
      source: "screen",
      mic: true,
      systemAudio: true,
      countdown: true,
    })
  })
})
