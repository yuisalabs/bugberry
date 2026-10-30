import { describe, expect, test } from "bun:test"
import { capturePrefsFrom, createCapturePrefsStorage, DEFAULT_CAPTURE_PREFS, recordOptionsFor } from "../../lib/capture/capture-prefs"

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
      captureKind: "screenshot",
      micDeviceId: null,
      camera: false,
      cameraDeviceId: null,
      cameraShape: "circle",
    })
  })

  test("camera fields fall back on their own", () => {
    expect(capturePrefsFrom({ camera: "yes", cameraDeviceId: 3, cameraShape: "square" })).toMatchObject({ camera: false, cameraDeviceId: null, cameraShape: "circle" })
    expect(capturePrefsFrom({ camera: true, cameraDeviceId: "cam1", cameraShape: "rectangle" })).toMatchObject({ camera: true, cameraDeviceId: "cam1", cameraShape: "rectangle" })
  })

  test("old prefs without the new fields get their defaults", () => {
    expect(capturePrefsFrom({ screenshotMode: "area" })).toMatchObject({ screenshotMode: "area", captureKind: "screenshot", micDeviceId: null })
    expect(capturePrefsFrom({ captureKind: "record", micDeviceId: "abc" })).toMatchObject({ captureKind: "record", micDeviceId: "abc" })
    expect(capturePrefsFrom({ captureKind: "nope", micDeviceId: 5 })).toMatchObject({ captureKind: "screenshot", micDeviceId: null })
  })

  test("each bad field falls back on its own", () => {
    expect(capturePrefsFrom({ screenshotMode: "full", recordSource: "window", mic: "yes" })).toEqual({
      screenshotMode: "visible",
      recordSource: "window",
      mic: false,
      systemAudio: true,
      countdown: true,
      captureKind: "screenshot",
      micDeviceId: null,
      camera: false,
      cameraDeviceId: null,
      cameraShape: "circle",
    })
  })
})

describe("capture prefs storage", () => {
  test("a change keeps the other choices", async () => {
    const area = memoryArea()
    const prefs = createCapturePrefsStorage(area)
    expect(await prefs.set({ mic: true })).toMatchObject({ mic: true, recordSource: "tab" })
    await prefs.set({ recordSource: "screen" })
    expect(await prefs.get()).toEqual({ ...DEFAULT_CAPTURE_PREFS, recordSource: "screen", mic: true })
    expect(Object.keys(area.items)).toEqual(["capturePrefs"])
  })
})

describe("recordOptionsFor", () => {
  test("without a tab recorder, tab becomes window and system audio is off", () => {
    expect(recordOptionsFor({ ...DEFAULT_CAPTURE_PREFS, recordSource: "tab", systemAudio: true }, false)).toEqual({
      source: "window",
      mic: false,
      micDeviceId: null,
      systemAudio: false,
      countdown: true,
      camera: null,
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
      micDeviceId: null,
      systemAudio: true,
      countdown: true,
      camera: null,
    })
  })

  test("recordOptionsFor carries the microphone id", () => {
    expect(recordOptionsFor({ ...DEFAULT_CAPTURE_PREFS, micDeviceId: "abc" }, true).micDeviceId).toBe("abc")
  })

  test("the camera only goes with a tab", () => {
    const prefs = { ...DEFAULT_CAPTURE_PREFS, camera: true, cameraDeviceId: "cam1", cameraShape: "rectangle" as const }
    expect(recordOptionsFor({ ...prefs, recordSource: "tab" }, true).camera).toEqual({ deviceId: "cam1", shape: "rectangle" })
    expect(recordOptionsFor({ ...prefs, recordSource: "screen" }, true).camera).toBeNull()
    expect(recordOptionsFor({ ...prefs, recordSource: "window" }, true).camera).toBeNull()
    // Firefox: a tab is recorded as a window.
    expect(recordOptionsFor({ ...prefs, recordSource: "tab" }, false).camera).toBeNull()
    expect(recordOptionsFor({ ...prefs, camera: false }, true).camera).toBeNull()
  })
})
