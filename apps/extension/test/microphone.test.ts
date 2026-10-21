import { describe, expect, test } from "bun:test"
import { micAccess, micChoiceAfterCheck, micDevices, micErrorText } from "../lib/microphone"

const input = (deviceId: string, label: string, groupId = deviceId) => ({ kind: "audioinput", deviceId, groupId, label })

describe("micDevices", () => {
  test("a built-in array", () => {
    expect(micDevices([input("a", "Microphone Array (Realtek(R) Audio)")]).devices).toEqual([
      { id: "a", name: "Microphone Array", detail: "Realtek(R) Audio · built-in", short: "Realtek Audio", kind: "built-in" },
    ])
  })

  test("headset and USB", () => {
    const { devices } = micDevices([input("h", "AirPods Pro"), input("u", "Blue Yeti (046d:0aaa)")])
    expect(devices[0]).toEqual({ id: "h", name: "AirPods Pro", detail: "Bluetooth headset", short: "AirPods Pro", kind: "headset" })
    expect(devices[1]).toEqual({ id: "u", name: "Blue Yeti", detail: "USB microphone", short: "Blue Yeti", kind: "usb" })
  })

  test("pseudo-entries are skipped and give the default", () => {
    const result = micDevices([
      input("default", "Default - Headset Mic", "g2"),
      input("communications", "Communications - Headset Mic", "g2"),
      input("a", "Mic A", "g1"),
      input("b", "Headset Mic", "g2"),
      { kind: "videoinput", deviceId: "cam", groupId: "g3", label: "Camera" },
    ])
    expect(result.devices.map((device) => device.id)).toEqual(["a", "b"])
    expect(result.defaultId).toBe("b")
  })

  test("without a default entry the first device is the default", () => {
    expect(micDevices([input("a", "Mic A"), input("b", "Mic B")]).defaultId).toBe("a")
  })

  test("no permission: no devices", () => {
    expect(micDevices([input("", ""), input("", "")])).toEqual({ devices: [], defaultId: null })
  })

  test("Default - prefix", () => {
    expect(micDevices([input("x", "Default - USB Mic")]).devices[0]?.name).toBe("USB Mic")
  })
})

describe("micAccess", () => {
  test("maps the permission state, and an error means Chrome has to ask", async () => {
    expect(await micAccess(async () => ({ state: "granted" }))).toBe("granted")
    expect(await micAccess(async () => ({ state: "denied" }))).toBe("denied")
    expect(await micAccess(async () => ({ state: "prompt" }))).toBe("prompt")
    expect(await micAccess(() => Promise.reject(new TypeError("unsupported")))).toBe("prompt")
  })
})

test("a Mic choice whose permission is gone is turned off when the popup opens", () => {
  expect(micChoiceAfterCheck(true, "granted")).toBe(true)
  expect(micChoiceAfterCheck(true, "denied")).toBe(false)
  expect(micChoiceAfterCheck(true, "prompt")).toBe(false)
  expect(micChoiceAfterCheck(false, "granted")).toBe(false)
})

test("the microphone page says what actually went wrong", () => {
  const error = (name: string) => new DOMException("x", name)
  expect(micErrorText(error("NotAllowedError"), "denied")).toBe("Microphone is blocked. Allow it for BugBerry in Chrome's site settings.")
  // A prompt closed without an answer leaves the permission at "prompt": nothing is blocked.
  expect(micErrorText(error("NotAllowedError"), "prompt")).toBe("Chrome didn't get an answer. Try again and choose Allow.")
  // Chrome allows it, the computer doesn't: macOS or Windows privacy settings.
  expect(micErrorText(error("NotAllowedError"), "granted")).toBe(
    "Your computer's privacy settings block the microphone for Chrome. Allow it there, then try again.",
  )
  expect(micErrorText(error("NotReadableError"), "granted")).toBe("The microphone is in use by another app. Close it there, then try again.")
  expect(micErrorText(error("NotFoundError"), "prompt")).toBe("No microphone was found.")
  expect(micErrorText(new Error("odd"), "prompt")).toBe("The microphone couldn't be started. Try again.")
})
